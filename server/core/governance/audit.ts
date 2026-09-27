import { and, eq, desc } from 'drizzle-orm'
import { auditEvents } from '../../database/schema'
import type { Transaction } from '../../database/client'
import { requirePermission, type ActorAccess } from '../iam/access'
import { unitPageInput } from '../organization/units'
// [MBX-5][AUDIT-001] Tenant-wide audit is an explicit permission, never a Unit grant.
export async function listAudit(tx: Transaction, actor: ActorAccess, page = 1) {
  requirePermission(actor,'audit.read')
  return tx.select().from(auditEvents).where(and(eq(auditEvents.tenantId,actor.tenantId))).orderBy(desc(auditEvents.createdAt),desc(auditEvents.id)).limit(50).offset((unitPageInput.parse(page)-1)*50)
}
