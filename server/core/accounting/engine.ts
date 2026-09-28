import { createHash, randomUUID } from 'node:crypto'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { accountingMappingRevisions, accountingMappings, accountingPeriods, auditEvents, journalLines, journals, ledgerAccounts, parties, partyRoles } from '../../database/schema'
import type { Transaction } from '../../database/client'
import { AccessDenied, requirePermission, type ActorAccess } from '../iam/access'
import { lockAdministration, ManagementConflict } from '../iam/users'
import { validateOrganizationContext, validateTransactionContext } from '../governance/transaction-context'
import { typeInput } from '../governance/configuration'

// [MBX-6][ACC-001..005][LOCK-001] Exact whole-rupiah strings at every external boundary.
const maxAmount = 9223372036854775807n
export const moneyInput = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(v => BigInt(v) <= maxAmount)
const positiveMoney = moneyInput.refine(v => BigInt(v) > 0n)
export const bookDateInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/).refine(v => {
  const date = new Date(v + 'T00:00:00.000Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === v
})
const accountInput = z.object({ code:z.string().trim().regex(/^[A-Z0-9.-]{2,32}$/), name:z.string().trim().min(1).max(160), kind:z.enum(['asset','liability','equity','revenue','expense']) }).strict()
const mappingRule = z.object({ accountId:z.uuid(), side:z.enum(['debit','credit']), amountKey:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), unitDimension:z.literal('event_unit') }).strict()
const mappingInput = z.object({ eventType:typeInput, schemaVersion:z.number().int().positive(), expectedRevision:z.number().int().nonnegative(), rules:z.array(mappingRule).min(2).max(30) }).strict()
const eventInput = z.object({ eventId:z.uuid(), eventType:typeInput, schemaVersion:z.number().int().positive(), bookDate:bookDateInput,
  unitId:z.uuid(), locationId:z.uuid().nullable().default(null), partyId:z.uuid().nullable().default(null), partyRole:z.enum(['customer','vendor']).default('customer'), createsAR:z.boolean(),
  amounts:z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),positiveMoney).refine(v => Object.keys(v).length > 0 && Object.keys(v).length <= 30) }).strict()
const correctionInput = z.object({ eventId:z.uuid(), bookDate:bookDateInput, originalJournalId:z.uuid() }).strict()
const adjustmentInput = correctionInput.extend({ lines:z.array(z.object({ accountId:z.uuid(),unitId:z.uuid(),side:z.enum(['debit','credit']),amount:positiveMoney }).strict()).min(2).max(100) }).strict()
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const periodMonth = (date: string) => date.slice(0,7)
async function assertOpen(tx:Transaction, tenantId:string, date:string) {
  const [closed] = await tx.select({id:accountingPeriods.id}).from(accountingPeriods).where(and(eq(accountingPeriods.tenantId,tenantId),eq(accountingPeriods.month,periodMonth(date))))
  if (closed) throw new ManagementConflict('Periode akuntansi sudah ditutup.')
}
async function insertPosted(tx:Transaction, actor:ActorAccess, data:{eventId:string;fingerprint:string;eventType:string;schemaVersion:number;mappingRevision:number|null;bookDate:string;kind:'normal'|'reversal'|'adjustment';correctsId?:string|null;lines:{accountId:string;unitId:string;side:'debit'|'credit';amount:bigint}[]},requestId:string) {
  if (data.lines.length < 2) throw new ManagementConflict('Jurnal membutuhkan minimal dua baris.')
  const debit = data.lines.reduce((sum,l) => sum + (l.side === 'debit' ? l.amount : 0n),0n)
  const credit = data.lines.reduce((sum,l) => sum + (l.side === 'credit' ? l.amount : 0n),0n)
  if (debit === 0n || debit !== credit || debit > maxAmount) throw new ManagementConflict('Total debit dan kredit harus sama dan dalam batas IDR.')
  await assertOpen(tx,actor.tenantId,data.bookDate)
  const [journal] = await tx.insert(journals).values({tenantId:actor.tenantId,eventId:data.eventId,fingerprint:data.fingerprint,eventType:data.eventType,
    schemaVersion:data.schemaVersion,mappingRevision:data.mappingRevision,bookDate:data.bookDate,kind:data.kind,correctsId:data.correctsId || null,actorId:actor.userId}).returning()
  await tx.insert(journalLines).values(data.lines.map((l,i)=>({tenantId:actor.tenantId,journalId:journal!.id,lineNo:i+1,
    accountId:l.accountId,unitId:l.unitId,debit:l.side==='debit'?l.amount:0n,credit:l.side==='credit'?l.amount:0n})))
  await tx.insert(auditEvents).values({tenantId:actor.tenantId,actorId:actor.userId,action:'journal.'+data.kind+'_posted',entityId:journal!.id,requestId,
    before:null,after:{eventId:data.eventId,bookDate:data.bookDate,correctsId:data.correctsId || null,debit:debit.toString(),lineCount:data.lines.length,mappingRevision:data.mappingRevision}})
  return journal!
}
async function existingRetry(tx:Transaction,actor:ActorAccess,eventId:string,hash:string) {
  const [existing] = await tx.select().from(journals).where(and(eq(journals.tenantId,actor.tenantId),eq(journals.eventId,eventId)))
  if (existing && existing.fingerprint !== hash) throw new ManagementConflict('Event ID sudah dipakai untuk payload berbeda.')
  return existing
}
export async function createLedgerAccount(tx:Transaction,actor:ActorAccess,input:unknown,requestId:string) {
  const data=accountInput.parse(input)
  await lockAdministration(tx,actor,'financial.configure')
  const [account]=await tx.insert(ledgerAccounts).values({...data,tenantId:actor.tenantId}).returning()
  await tx.insert(auditEvents).values({tenantId:actor.tenantId,actorId:actor.userId,action:'ledger_account.created',entityId:account!.id,requestId,before:null,after:data})
  return account!
}
export async function setAccountingMapping(tx:Transaction,actor:ActorAccess,input:unknown,requestId:string) {
  const data=mappingInput.parse(input)
  await lockAdministration(tx,actor,'financial.configure')
  const [before]=await tx.select().from(accountingMappings).where(and(eq(accountingMappings.tenantId,actor.tenantId),eq(accountingMappings.eventType,data.eventType),eq(accountingMappings.schemaVersion,data.schemaVersion)))
  if ((before?.revision || 0)!==data.expectedRevision) throw new ManagementConflict('Mapping telah berubah; muat ulang.')
  for (const id of new Set(data.rules.map(r=>r.accountId))) {
    const [account]=await tx.select({id:ledgerAccounts.id}).from(ledgerAccounts).where(and(eq(ledgerAccounts.tenantId,actor.tenantId),eq(ledgerAccounts.id,id),eq(ledgerAccounts.active,true)))
    if (!account) throw new AccessDenied('Mapping account unavailable')
  }
  const revision=data.expectedRevision+1
  const [result]=await tx.insert(accountingMappings).values({tenantId:actor.tenantId,eventType:data.eventType,schemaVersion:data.schemaVersion,revision,rules:data.rules})
    .onConflictDoUpdate({target:[accountingMappings.tenantId,accountingMappings.eventType,accountingMappings.schemaVersion],set:{revision,rules:data.rules,updatedAt:new Date()}}).returning()
  await tx.insert(accountingMappingRevisions).values({tenantId:actor.tenantId,eventType:data.eventType,schemaVersion:data.schemaVersion,revision,rules:data.rules,actorId:actor.userId})
  await tx.insert(auditEvents).values({tenantId:actor.tenantId,actorId:actor.userId,action:'accounting_mapping.updated',entityId:result!.id,requestId,before:before?{revision:before.revision,rules:before.rules}:null,after:{revision,rules:data.rules}})
  return result!
}
// [MBX-7][MAP-001..004] Called by a business module inside its own transaction. No module supplies ledger account IDs.
export async function postBusinessEvent(tx:Transaction,actor:ActorAccess,input:unknown,requestId:string) {
  const event=eventInput.parse(input)
  const hash=fingerprint({...event,amounts:Object.fromEntries(Object.entries(event.amounts).sort(([a],[b])=>a.localeCompare(b)))})
  // A Location-only grant cannot safely post until Location is persisted on journal lines.
  await lockAdministration(tx,actor,'financial.post',event.unitId)
  const retry=await existingRetry(tx,actor,event.eventId,hash)
  if (retry) return retry
  if(event.partyRole==='customer') {
    await validateTransactionContext(tx,actor,{type:event.eventType,unitId:event.unitId,locationId:event.locationId,partyId:event.partyId,createsAR:event.createsAR})
  } else {
    if(event.createsAR || !event.partyId) throw new AccessDenied('Vendor event requires identified Vendor and cannot create AR')
    await lockAdministration(tx,actor,'transaction.context',event.unitId,event.locationId || undefined)
    await validateOrganizationContext(tx,actor,event.unitId,event.locationId)
    const [party]=await tx.select({id:parties.id}).from(parties).where(and(eq(parties.tenantId,actor.tenantId),eq(parties.id,event.partyId),eq(parties.active,true)))
    const [role]=await tx.select({id:partyRoles.id}).from(partyRoles).where(and(eq(partyRoles.tenantId,actor.tenantId),eq(partyRoles.partyId,event.partyId),eq(partyRoles.role,'vendor'),or(eq(partyRoles.unitId,event.unitId),isNull(partyRoles.unitId))))
    if(!party||!role) throw new AccessDenied('Vendor Party unavailable in Unit')
  }
  const [mapping]=await tx.select().from(accountingMappings).where(and(eq(accountingMappings.tenantId,actor.tenantId),eq(accountingMappings.eventType,event.eventType),eq(accountingMappings.schemaVersion,event.schemaVersion),eq(accountingMappings.active,true)))
  if (!mapping) throw new ManagementConflict('Mapping akuntansi belum tersedia.')
  const rules=z.array(mappingRule).min(2).max(30).parse(mapping.rules)
  if(Object.keys(event.amounts).some(key=>!rules.some(rule=>rule.amountKey===key))) throw new ManagementConflict('Nilai event belum seluruhnya dipetakan.')
  const lines=[] as {accountId:string;unitId:string;side:'debit'|'credit';amount:bigint}[]
  for (const rule of rules) {
    const amount=event.amounts[rule.amountKey]
    if (!amount) throw new ManagementConflict('Nilai untuk mapping tidak tersedia.')
    const [account]=await tx.select({id:ledgerAccounts.id}).from(ledgerAccounts).where(and(eq(ledgerAccounts.tenantId,actor.tenantId),eq(ledgerAccounts.id,rule.accountId),eq(ledgerAccounts.active,true)))
    if (!account) throw new ManagementConflict('Akun mapping tidak tersedia atau nonaktif.')
    lines.push({accountId:account.id,unitId:event.unitId,side:rule.side,amount:BigInt(amount)})
  }
  return insertPosted(tx,actor,{eventId:event.eventId,fingerprint:hash,eventType:event.eventType,schemaVersion:event.schemaVersion,mappingRevision:mapping.revision,bookDate:event.bookDate,kind:'normal',lines},requestId)
}
export async function closeAccountingPeriod(tx:Transaction,actor:ActorAccess,month:unknown,requestId:string) {
  const value=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(month)
  await lockAdministration(tx,actor,'period.close')
  const [before]=await tx.select().from(accountingPeriods).where(and(eq(accountingPeriods.tenantId,actor.tenantId),eq(accountingPeriods.month,value)))
  if (before) throw new ManagementConflict('Periode sudah ditutup.')
  const [period]=await tx.insert(accountingPeriods).values({tenantId:actor.tenantId,month:value,closedBy:actor.userId}).returning()
  await tx.insert(auditEvents).values({tenantId:actor.tenantId,actorId:actor.userId,action:'accounting_period.closed',entityId:period!.id,requestId,before:null,after:{month:value}})
  return period!
}
export async function reverseJournal(tx:Transaction,actor:ActorAccess,input:unknown,requestId:string) {
  const data=correctionInput.parse(input)
  const [original]=await tx.select().from(journals).where(and(eq(journals.tenantId,actor.tenantId),eq(journals.id,data.originalJournalId)))
  if (!original || original.kind==='reversal') throw new AccessDenied('Original journal unavailable')
  const source=await tx.select().from(journalLines).where(and(eq(journalLines.tenantId,actor.tenantId),eq(journalLines.journalId,original.id))).orderBy(journalLines.lineNo)
  for (const unitId of new Set(source.map(row=>row.unitId))) await lockAdministration(tx,actor,'financial.post',unitId)
  const hash=fingerprint({kind:'reversal',...data})
  const retry=await existingRetry(tx,actor,data.eventId,hash)
  if (retry) return retry
  return insertPosted(tx,actor,{eventId:data.eventId,fingerprint:hash,eventType:'journal_reversal',schemaVersion:1,mappingRevision:null,bookDate:data.bookDate,kind:'reversal',correctsId:original.id,
    lines:source.map(row=>({accountId:row.accountId,unitId:row.unitId,side:row.debit>0n?'credit':'debit',amount:row.debit>0n?row.debit:row.credit}))},requestId)
}
export async function adjustJournal(tx:Transaction,actor:ActorAccess,input:unknown,requestId:string) {
  const data=adjustmentInput.parse(input)
  for (const unitId of new Set(data.lines.map(line=>line.unitId))) await lockAdministration(tx,actor,'financial.post',unitId)
  const hash=fingerprint({kind:'adjustment',...data})
  const retry=await existingRetry(tx,actor,data.eventId,hash)
  if (retry) return retry
  const [original]=await tx.select({id:journals.id}).from(journals).where(and(eq(journals.tenantId,actor.tenantId),eq(journals.id,data.originalJournalId)))
  if (!original) throw new AccessDenied('Original journal unavailable')
  const source=await tx.select({unitId:journalLines.unitId}).from(journalLines).where(and(eq(journalLines.tenantId,actor.tenantId),eq(journalLines.journalId,original.id)))
  for (const unitId of new Set(source.map(row=>row.unitId))) await lockAdministration(tx,actor,'financial.post',unitId)
  for (const line of data.lines) {
    await validateOrganizationContext(tx,actor,line.unitId)
    const [account]=await tx.select({id:ledgerAccounts.id}).from(ledgerAccounts).where(and(eq(ledgerAccounts.tenantId,actor.tenantId),eq(ledgerAccounts.id,line.accountId),eq(ledgerAccounts.active,true)))
    if (!account) throw new AccessDenied('Adjustment account unavailable')
  }
  return insertPosted(tx,actor,{eventId:data.eventId,fingerprint:hash,eventType:'journal_adjustment',schemaVersion:1,mappingRevision:null,bookDate:data.bookDate,kind:'adjustment',correctsId:original.id,
    lines:data.lines.map(l=>({...l,amount:BigInt(l.amount)}))},requestId)
}
export async function trialBalance(tx:Transaction,actor:ActorAccess,query:unknown) {
  const q=z.object({ from:bookDateInput.optional(),through:bookDateInput,unitId:z.uuid().optional() }).strict().parse(query)
  if(q.from && q.from>q.through) throw new ManagementConflict('Rentang tanggal tidak valid.')
  requirePermission(actor,'financial.read',q.unitId)
  const rows=await tx.execute(sql`SELECT a.id AS account_id,a.code,a.name,a.kind,
    sum(l.debit)::text AS debit_total,sum(l.credit)::text AS credit_total
    FROM journal_lines l JOIN journals j ON j.tenant_id=l.tenant_id AND j.id=l.journal_id
    JOIN ledger_accounts a ON a.tenant_id=l.tenant_id AND a.id=l.account_id
    WHERE l.tenant_id=${actor.tenantId} AND j.book_date <= ${q.through}::date
      AND (${q.from || null}::date IS NULL OR j.book_date >= ${q.from || null}::date)
      AND (${q.unitId || null}::uuid IS NULL OR l.unit_id=${q.unitId || null}::uuid)
    GROUP BY a.id,a.code,a.name,a.kind ORDER BY a.code`)
  return rows.map(row=>{
    const net=BigInt(String(row.debit_total))-BigInt(String(row.credit_total))
    return {accountId:row.account_id,code:row.code,name:row.name,kind:row.kind,
      debit:(net>0n?net:0n).toString(),credit:(net<0n?-net:0n).toString(),
      turnoverDebit:row.debit_total,turnoverCredit:row.credit_total,netDebit:net.toString()}
  })
}
export async function ledger(tx:Transaction,actor:ActorAccess,query:unknown) {
  const q=z.object({ accountId:z.uuid(),from:bookDateInput,through:bookDateInput,unitId:z.uuid().optional() }).strict().parse(query)
  if(q.from>q.through) throw new ManagementConflict('Rentang tanggal tidak valid.')
  requirePermission(actor,'financial.read',q.unitId)
  const [account]=await tx.select({id:ledgerAccounts.id}).from(ledgerAccounts).where(and(eq(ledgerAccounts.tenantId,actor.tenantId),eq(ledgerAccounts.id,q.accountId)))
  if(!account) throw new AccessDenied('Account unavailable')
  const opening=await tx.execute(sql`SELECT coalesce(sum(l.debit-l.credit),0)::text AS balance
    FROM journal_lines l JOIN journals j ON j.tenant_id=l.tenant_id AND j.id=l.journal_id
    WHERE l.tenant_id=${actor.tenantId} AND l.account_id=${q.accountId} AND j.book_date < ${q.from}::date
      AND (${q.unitId || null}::uuid IS NULL OR l.unit_id=${q.unitId || null}::uuid)`)
  const rows=await tx.execute(sql`SELECT j.id AS journal_id,j.book_date,l.line_no,l.unit_id,l.debit::text AS debit,l.credit::text AS credit
    FROM journal_lines l JOIN journals j ON j.tenant_id=l.tenant_id AND j.id=l.journal_id
    WHERE l.tenant_id=${actor.tenantId} AND l.account_id=${q.accountId}
      AND j.book_date BETWEEN ${q.from}::date AND ${q.through}::date
      AND (${q.unitId || null}::uuid IS NULL OR l.unit_id=${q.unitId || null}::uuid)
    ORDER BY j.book_date,j.created_at,j.id,l.line_no`)
  let running=BigInt(String(opening[0]?.balance || '0'))
  return {openingBalance:running.toString(),entries:rows.map(row=>{
    running+=BigInt(String(row.debit))-BigInt(String(row.credit))
    return {...row,runningBalance:running.toString()}
  })}
}
