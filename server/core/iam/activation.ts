import { randomUUID } from 'node:crypto'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { z } from 'zod'
import type { Database } from '../../database/client'
import { account, auditEvents, memberships, tenants, verification, user } from '../../database/schema'
import { AccessDenied } from './access'
import { activationIdentifier, hashActivationToken } from './users'

// MBX-5 / IAM-001, AUDIT-001. Possession of a live hashed token is the activation proof.
export async function activateAccount(db: Database, input: unknown, requestId: string) {
  const data = z.object({ userId: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password: z.string().min(12).max(128) }).strict().parse(input)
  return db.transaction(async tx => {
    const identifiers = [activationIdentifier(data.userId), activationIdentifier(data.userId, 'manual')]
    const predicate = and(inArray(verification.identifier, identifiers), eq(verification.value, hashActivationToken(data.token)), gt(verification.expiresAt, new Date()))
    if (!(await tx.select({ id: verification.id }).from(verification).where(predicate))[0]) throw new AccessDenied('Activation invalid')
    await tx.execute(sql`SELECT set_config('app.actor_id', ${data.userId}, true)`)
    const [member] = await tx.select().from(memberships).where(eq(memberships.userId, data.userId))
    if (!member) throw new AccessDenied('Activation invalid')
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${member.tenantId}, true)`)
    const [tenant] = await tx.select().from(tenants).where(and(eq(tenants.id, member.tenantId), eq(tenants.active, true))).for('update')
    if (!tenant) throw new AccessDenied('Activation invalid')
    const [token] = await tx.select().from(verification).where(and(inArray(verification.identifier, identifiers), eq(verification.value, hashActivationToken(data.token)), gt(verification.expiresAt, new Date()))).for('update')
    const [current] = await tx.select().from(memberships).where(eq(memberships.id, member.id))
    if (!token || !current?.pending || current.active) throw new AccessDenied('Activation invalid')
    const password = await hashPassword(data.password)
    await tx.insert(account).values({ id: randomUUID(), accountId: data.userId, providerId: 'credential', userId: data.userId, password })
    await tx.update(memberships).set({ active: true, pending: false }).where(eq(memberships.id, member.id))
    const delivery = token.identifier === activationIdentifier(data.userId, 'manual') ? 'manual' : 'email'
    // Admin delivery proves possession of the link, not ownership of the email address.
    if (delivery === 'email') await tx.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, data.userId))
    await tx.delete(verification).where(eq(verification.id, token.id))
    await tx.insert(auditEvents).values({ tenantId: member.tenantId, actorId: data.userId, action: 'account.activated', entityId: data.userId, requestId, after: { active: true, delivery } })
    return { activated: true }
  })
}
