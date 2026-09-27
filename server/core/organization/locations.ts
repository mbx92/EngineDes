import { and, eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { locations, units, auditEvents } from '../../database/schema'
import type { Transaction } from '../../database/client'
import { can, AccessDenied, type ActorAccess } from '../iam/access'
import { lockAdministration } from '../iam/users'
import { unitPageInput } from './units'
// [MBX-5][ORG-002][IAM-002] Location reads retain assignment boundaries.
export async function listLocations(tx: Transaction, actor: ActorAccess, page = 1) {
  const unrestricted = can(actor, 'unit.read', actor.tenantId)
  const scopes = actor.grants.filter(g => g.unitId && can(actor, 'unit.read', actor.tenantId, g.unitId, g.locationId || undefined))
  if (!unrestricted && !scopes.length) throw new AccessDenied('Location access denied')
  return tx.select({ id: locations.id, unitId: locations.unitId, name: locations.name, code: locations.code, active: locations.active, unitName: units.name })
    .from(locations).innerJoin(units, and(eq(units.id, locations.unitId), eq(units.tenantId, locations.tenantId)))
    .where(and(eq(locations.tenantId, actor.tenantId), unrestricted ? undefined : or(...scopes.map(g => and(eq(locations.unitId, g.unitId!), g.locationId ? eq(locations.id, g.locationId) : undefined)))))
    .orderBy(units.name, locations.name, locations.id).limit(50).offset((unitPageInput.parse(page) - 1) * 50)
}
export async function createLocation(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = z.object({ unitId: z.uuid(), name: z.string().trim().min(1).max(160), code: z.string().trim().min(1).max(40) }).strict().parse(input)
  await lockAdministration(tx, actor, 'location.manage')
  const [unit] = await tx.select().from(units).where(and(eq(units.id, data.unitId), eq(units.tenantId, actor.tenantId), eq(units.active, true)))
  if (!unit) throw new AccessDenied('Invalid Unit')
  const [result] = await tx.insert(locations).values({ ...data, tenantId: actor.tenantId }).returning()
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'location.created', entityId: result!.id, requestId, after: data })
  return result!
}
