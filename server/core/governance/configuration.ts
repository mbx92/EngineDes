import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { configurations, configurationRevisions, auditEvents } from '../../database/schema'
import type { Transaction } from '../../database/client'
import type { ActorAccess } from '../iam/access'
import { requirePermission } from '../iam/access'
import { lockAdministration, ManagementConflict } from '../iam/users'

// [MBX-5][CFG-001][AUDIT-001] Settings are validated, revisioned and audited atomically.
export const typeInput = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)
export const securityInput = z.object({ timezone: z.string().max(80).refine(v => {
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true } catch { return false }
}), passwordMinimum: z.number().int().min(12).max(128), separationOfDuties: z.boolean() }).strict()
export const customerInput = z.object({ anonymousAllowed: z.boolean() }).strict()
export const sequenceInput = z.object({ prefix: z.string().regex(/^[A-Z0-9-]{1,20}$/), scope: z.enum(['tenant', 'unit']), reset: z.enum(['never', 'year', 'month']) }).strict()
export const securityDefaults = { timezone: 'UTC', passwordMinimum: 12, separationOfDuties: true }
function parseValue(key: string, value: unknown) {
  if (key === 'security') return securityInput.parse(value)
  const [kind, type, extra] = key.split(':')
  typeInput.parse(type)
  if (extra) throw new ManagementConflict('Invalid configuration key')
  if (kind === 'customer') return customerInput.parse(value)
  if (kind === 'sequence') return sequenceInput.parse(value)
  throw new ManagementConflict('Unsupported configuration')
}
export async function readConfiguration(tx: Transaction, tenantId: string, key: string) {
  return (await tx.select().from(configurations).where(and(eq(configurations.tenantId, tenantId), eq(configurations.key, key))))[0]
}
export async function securityPolicy(tx: Transaction, tenantId: string) {
  const config = await readConfiguration(tx, tenantId, 'security')
  return config ? securityInput.parse(config.value) : securityDefaults
}
export async function listConfigurations(tx: Transaction, actor: ActorAccess) {
  requirePermission(actor, 'configuration.manage')
  return tx.select().from(configurations).where(eq(configurations.tenantId, actor.tenantId)).orderBy(configurations.key)
}
export async function setConfiguration(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = z.object({ key: z.string().max(60), value: z.unknown(), expectedRevision: z.number().int().min(0) }).strict().parse(input)
  const value = parseValue(data.key, data.value)
  await lockAdministration(tx, actor, 'configuration.manage')
  const before = await readConfiguration(tx, actor.tenantId, data.key)
  if ((before?.revision || 0) !== data.expectedRevision) throw new ManagementConflict('Konfigurasi telah berubah. Muat ulang sebelum menyimpan.')
  // Never change the scope or reset rule after allocation; preserve historical numbering.
  if (before && data.key.startsWith('sequence:') && JSON.stringify(before.value) !== JSON.stringify(value)) {
    // Prefix changes are also forbidden once the sequence exists. New type = new sequence.
    throw new ManagementConflict('Sequence sudah dikonfigurasi; gunakan jenis dokumen baru untuk format berbeda.')
  }
  const revision = (before?.revision || 0) + 1
  const [result] = await tx.insert(configurations).values({ tenantId: actor.tenantId, key: data.key, value, revision })
    .onConflictDoUpdate({ target: [configurations.tenantId, configurations.key], set: { value, revision, updatedAt: new Date() } }).returning()
  await tx.insert(configurationRevisions).values({ tenantId: actor.tenantId, key: data.key, value, revision, actorId: actor.userId })
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'configuration.updated', entityId: result!.id, requestId,
    before: before ? { key: before.key, revision: before.revision, value: before.value } : null, after: { key: data.key, revision, value } })
  return result!
}
