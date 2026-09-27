import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { units, auditEvents } from '../../database/schema'
import type { Transaction } from '../../database/client'
import { readableUnits, requirePermission, type ActorAccess } from '../iam/access'

export const createUnitInput = z.object({ name: z.string().trim().min(1).max(160), code: z.string().trim().min(1).max(40) }).strict()
export const unitPageInput = z.coerce.number().int().min(1).max(100000).default(1)
// MBX-5 / ORG-001/002, IAM-001/002: list is restricted at the query, not in the UI.
export async function listUnits(tx: Transaction, access: ActorAccess, page = 1) {
  page = unitPageInput.parse(page)
  const ids = readableUnits(access)
  if (ids?.length === 0) { requirePermission(access, 'unit.read'); return [] }
  return tx.select({ id: units.id, name: units.name, code: units.code, active: units.active }).from(units)
    .where(and(eq(units.tenantId, access.tenantId), ids ? inArray(units.id, ids) : undefined)).orderBy(units.name, units.id).limit(50).offset((page - 1) * 50)
}
// ORG-001 / AUDIT-001: caller owns one transaction for both Unit and audit insertion.
export async function createUnit(tx: Transaction, access: ActorAccess, input: unknown, requestId: string) {
  requirePermission(access, 'unit.create')
  const data = createUnitInput.parse(input)
  const [unit] = await tx.insert(units).values({ tenantId: access.tenantId, ...data }).returning()
  if (!unit) throw new Error('Unit creation failed')
  await tx.insert(auditEvents).values({ tenantId: access.tenantId, actorId: access.userId,
    action: 'unit.created', entityId: unit.id, before: null, after: { id: unit.id, name: unit.name, code: unit.code }, requestId })
  return { id: unit.id, name: unit.name, code: unit.code, active: unit.active }
}
