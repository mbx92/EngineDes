import { and, eq, exists, or, isNull, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { parties, partyRoles, units, auditEvents } from '../../database/schema'
import type { Transaction } from '../../database/client'
import { requirePermission, AccessDenied, type ActorAccess } from '../iam/access'
import { lockAdministration } from '../iam/users'
import { unitPageInput } from '../organization/units'
export const rolesInput = z.array(z.object({ role: z.enum(['customer','vendor','employee']), unitId: z.uuid().nullable() }).strict()).min(1).max(30)
  .refine(roles => new Set(roles.map(r => JSON.stringify(r))).size === roles.length, 'Duplicate role contexts')
export const partyInput = z.object({ kind: z.enum(['person','organization']), code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(160), roles: rolesInput }).strict()
// [MBX-5][PARTY-001/002] Identity is distinct from multiple contextual roles.
export async function listParties(tx: Transaction, actor: ActorAccess, query: unknown) {
  const { page, unitId, locationId } = z.object({ page: unitPageInput, unitId: z.uuid().optional(), locationId: z.uuid().optional() }).parse(query)
  requirePermission(actor, 'party.read', unitId, locationId)
  const rows = await tx.select().from(parties).where(and(eq(parties.tenantId, actor.tenantId), unitId ? exists(tx.select({ id: partyRoles.id }).from(partyRoles).where(and(eq(partyRoles.tenantId, actor.tenantId), eq(partyRoles.partyId, parties.id), or(eq(partyRoles.unitId, unitId), and(isNull(partyRoles.unitId), inArray(partyRoles.role, ['vendor','customer'])))))) : undefined))
    .orderBy(parties.name, parties.id).limit(50).offset((page - 1) * 50)
  const result = []
  for (const row of rows) {
    const roles = await tx.select({ role: partyRoles.role, unitId: partyRoles.unitId, unitName: units.name }).from(partyRoles).leftJoin(units,and(eq(units.id,partyRoles.unitId),eq(units.tenantId,partyRoles.tenantId))).where(and(eq(partyRoles.tenantId, actor.tenantId), eq(partyRoles.partyId, row.id), unitId ? or(eq(partyRoles.unitId, unitId), and(isNull(partyRoles.unitId), inArray(partyRoles.role,['vendor','customer']))) : undefined))
    result.push({ ...row, roles })
  }
  return result
}
export async function saveParty(tx: Transaction, actor: ActorAccess, id: string | undefined, input: unknown, requestId: string) {
  const { roles, ...data } = partyInput.parse(input)
  await lockAdministration(tx, actor, 'party.manage')
  for (const role of roles.filter(r => r.unitId)) {
    const [unit] = await tx.select({ id: units.id }).from(units).where(and(eq(units.id, role.unitId!), eq(units.tenantId, actor.tenantId), eq(units.active,true)))
    if (!unit) throw new AccessDenied('Invalid Party Unit')
  }
  const before = id ? (await tx.select().from(parties).where(and(eq(parties.id, z.uuid().parse(id)), eq(parties.tenantId, actor.tenantId))))[0] : null
  if (id && !before) throw new AccessDenied('Party not in tenant')
  const oldRoles = id ? await tx.select({ role: partyRoles.role, unitId: partyRoles.unitId, unitName: units.name }).from(partyRoles).leftJoin(units,and(eq(units.id,partyRoles.unitId),eq(units.tenantId,partyRoles.tenantId))).where(and(eq(partyRoles.tenantId, actor.tenantId),eq(partyRoles.partyId,id))) : []
  const [row] = id ? await tx.update(parties).set(data).where(and(eq(parties.id,id),eq(parties.tenantId,actor.tenantId))).returning()
    : await tx.insert(parties).values({ ...data, tenantId: actor.tenantId }).returning()
  await tx.delete(partyRoles).where(and(eq(partyRoles.partyId,row!.id),eq(partyRoles.tenantId,actor.tenantId)))
  await tx.insert(partyRoles).values(roles.map(role => ({ ...role, partyId: row!.id, tenantId: actor.tenantId })))
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: id ? 'party.updated' : 'party.created', entityId: row!.id, requestId, before: before ? { ...before, roles: oldRoles } : null, after: { ...data, roles } })
  return { ...row!, roles }
}
