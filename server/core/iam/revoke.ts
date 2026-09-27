import { and, eq } from 'drizzle-orm'
import { auditEvents, memberships, session } from '../../database/schema'
import type { Transaction } from '../../database/client'
import { AccessDenied, requirePermission, type ActorAccess } from './access'
// MBX-5 / IAM-001/002, AUDIT-001. Identity sessions are scoped through target membership first.
export async function revokeLogin(tx: Transaction, actor: ActorAccess, targetUserId: string, requestId: string) {
  requirePermission(actor, 'account.revoke')
  const [target] = await tx.select().from(memberships).where(and(eq(memberships.userId, targetUserId), eq(memberships.tenantId, actor.tenantId)))
  if (!target) throw new AccessDenied('Target not in tenant')
  await tx.delete(session).where(eq(session.userId, targetUserId))
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'account.sessions_revoked', entityId: targetUserId,
    requestId, before: null, after: { sessionsRevoked: true } })
  return { revoked: true }
}
