import { and, eq, or, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { units, locations, parties, partyRoles } from '../../database/schema'
import type { Transaction } from '../../database/client'
import { requirePermission, AccessDenied, type ActorAccess } from '../iam/access'
import { customerInput, readConfiguration, securityPolicy, typeInput } from './configuration'
import { lockAdministration } from '../iam/users'
// [MBX-5][ORG-003][PARTY-003/004] Consumers must call within their write transaction.
export const transactionContextInput = z.object({ type: typeInput, unitId: z.uuid(), locationId: z.uuid().nullable().default(null), partyId: z.uuid().nullable().default(null), createsAR: z.boolean() }).strict()
export async function validateTransactionContext(tx: Transaction, actor: ActorAccess, input: unknown) {
  const context = transactionContextInput.parse(input)
  await lockAdministration(tx, actor, 'transaction.context', context.unitId, context.locationId || undefined)
  await validateOrganizationContext(tx, actor, context.unitId, context.locationId)
  if (!context.partyId) {
    const policy = await readConfiguration(tx, actor.tenantId, 'customer:' + context.type)
    if (context.createsAR || !policy || !customerInput.parse(policy.value).anonymousAllowed) throw new AccessDenied('Identified Party required')
  } else {
    const [party] = await tx.select().from(parties).where(and(eq(parties.id,context.partyId),eq(parties.tenantId,actor.tenantId),eq(parties.active,true)))
    const [role] = await tx.select().from(partyRoles).where(and(eq(partyRoles.partyId,context.partyId),eq(partyRoles.tenantId,actor.tenantId),eq(partyRoles.role,'customer'),or(eq(partyRoles.unitId,context.unitId),isNull(partyRoles.unitId))))
    if (!party || !role) throw new AccessDenied('Customer Party not available in Unit')
  }
  return { ...context, tenantId: actor.tenantId }
}
export async function validateOrganizationContext(tx: Transaction, actor: ActorAccess, unitId: string, locationId: string | null = null) {
  const [unit] = await tx.select().from(units).where(and(eq(units.tenantId, actor.tenantId),eq(units.id,unitId),eq(units.active,true)))
  if (!unit) throw new AccessDenied('Active Unit required')
  if (locationId) {
    const [location] = await tx.select().from(locations).where(and(eq(locations.tenantId,actor.tenantId),eq(locations.unitId,unit.id),eq(locations.id,locationId),eq(locations.active,true)))
    if (!location) throw new AccessDenied('Active Location required within Unit')
  }
  return unit
}
// [IAM-003] Document creator comes from persisted module data, never an HTTP actor claim.
export async function requireApproval(tx: Transaction, actor: ActorAccess, document: { tenantId: string; unitId: string; locationId?: string | null; creatorId: string }) {
  if (document.tenantId !== actor.tenantId) throw new AccessDenied('Approval tenant denied')
  await lockAdministration(tx,actor,'approval.authorize',document.unitId,document.locationId || undefined)
  await validateOrganizationContext(tx,actor,document.unitId,document.locationId || null)
  if ((await securityPolicy(tx,actor.tenantId)).separationOfDuties && document.creatorId === actor.userId) throw new AccessDenied('Creator cannot approve own transaction')
}
