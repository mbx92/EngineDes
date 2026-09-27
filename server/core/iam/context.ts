import { and, eq, sql } from 'drizzle-orm'
import type { Database, Transaction } from '../../database/client'
import { memberships, roleGrants, tenants } from '../../database/schema'
import { AccessDenied, type ActorAccess } from './access'

// Verified session user only. No tenant state is kept on pooled sessions (ADR-009).
export async function withActor<T>(db: Database, userId: string, requestedTenantId: string | undefined,
  operation: (tx: Transaction, access: ActorAccess) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('app.actor_id', ${userId}, true)`)
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
    if (!member || (requestedTenantId && requestedTenantId !== member.tenantId)) throw new AccessDenied('Tenant access denied')
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${member.tenantId}, true)`)
    const [tenant] = await tx.select().from(tenants).where(and(eq(tenants.id, member.tenantId), eq(tenants.active, true)))
    if (!tenant) throw new AccessDenied('Tenant inactive')
    const grants = await tx.select({ role: roleGrants.role, scope: roleGrants.scope, unitId: roleGrants.unitId })
      .from(roleGrants).where(and(eq(roleGrants.tenantId, member.tenantId), eq(roleGrants.membershipId, member.id)))
    return operation(tx, { userId, tenantId: member.tenantId, membershipId: member.id, grants })
  })
}
