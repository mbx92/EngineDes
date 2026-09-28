import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Transaction } from '../../database/client'
import { units, documentNumbers, sequenceCounters, auditEvents } from '../../database/schema'
import { AccessDenied, requirePermission, type ActorAccess } from '../iam/access'
import { lockAdministration, ManagementConflict } from '../iam/users'
import { validateOrganizationContext } from './transaction-context'
import { readConfiguration, sequenceInput, typeInput } from './configuration'
const inputSchema = z.object({ type: typeInput, commandId: z.uuid(), unitId: z.uuid().nullable().default(null), locationId: z.uuid().nullable().default(null), period: z.string().max(7).default('') }).strict()
// [MBX-5][SEQ-001] Call inside the document transaction. Retry identity preserves numbers.
export async function allocateNumber(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = inputSchema.parse(input)
  await lockAdministration(tx,actor,'transaction.context',data.unitId || undefined,data.locationId || undefined)
  // Serialize retries of the same command, without serializing different counters globally.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.tenantId + ':' + data.type + ':' + data.commandId},0))`)
  const fingerprint = createHash('sha256').update(JSON.stringify({ type: data.type, unitId: data.unitId, locationId: data.locationId, period: data.period })).digest('hex')
  const [existing] = await tx.select().from(documentNumbers).where(and(eq(documentNumbers.tenantId,actor.tenantId),eq(documentNumbers.type,data.type),eq(documentNumbers.commandId,data.commandId)))
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new ManagementConflict('Retry context does not match original command')
    return existing
  }
  const config = await readConfiguration(tx,actor.tenantId,'sequence:' + data.type)
  if (!config) throw new ManagementConflict('Sequence belum dikonfigurasi')
  const policy = sequenceInput.parse(config.value)
  let unitCode = ''
  if (data.unitId) {
    const unit = await validateOrganizationContext(tx,actor,data.unitId,data.locationId)
    unitCode = unit.id // Stable identity: changing display code cannot reset/duplicate numbering.
  }
  if (policy.scope === 'unit' && !data.unitId) throw new AccessDenied('Unit required for sequence')
  const pattern = policy.reset === 'year' ? /^\d{4}$/ : /^\d{4}-(0[1-9]|1[0-2])$/
  if (policy.reset === 'never' ? data.period !== '' : !pattern.test(data.period)) throw new ManagementConflict('Invalid sequence business period')
  const key = JSON.stringify([data.type,policy.scope === 'unit' ? data.unitId : null,data.period])
  const [counter] = await tx.insert(sequenceCounters).values({ tenantId: actor.tenantId,key,value:1 })
    .onConflictDoUpdate({ target: [sequenceCounters.tenantId,sequenceCounters.key], set: { value: sql`${sequenceCounters.value}+1` } }).returning()
  const number = [policy.prefix,policy.scope === 'unit' ? unitCode : '',data.period,String(counter!.value).padStart(6,'0')].filter(Boolean).join('/')
  const [result] = await tx.insert(documentNumbers).values({ tenantId:actor.tenantId,type:data.type,commandId:data.commandId,fingerprint,number,configurationRevision:config.revision,unitId:data.unitId }).returning()
  await tx.insert(auditEvents).values({ tenantId:actor.tenantId,actorId:actor.userId,entityId:result!.id,action:'document.number_allocated',requestId,after:{number,type:data.type,configurationRevision:config.revision} })
  return result!
}
