import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { tenants, auditEvents } from '../../database/schema'
import type { Transaction } from '../../database/client'
import type { ActorAccess } from '../iam/access'
import { lockAdministration } from '../iam/users'
export async function updateOrganization(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const { name } = z.object({ name: z.string().trim().min(1).max(160) }).strict().parse(input)
  await lockAdministration(tx, actor, 'organization.update')
  const [before] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, actor.tenantId))
  await tx.update(tenants).set({ name }).where(eq(tenants.id, actor.tenantId))
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'organization.updated', entityId: actor.tenantId, requestId, before, after: { name } })
  return { updated: true }
}
