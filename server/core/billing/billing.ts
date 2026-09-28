import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { cashAccounts, financialDocumentEvents, financialDocuments, ledgerAccounts, parties, partyRoles, paymentAllocations, payments, auditEvents } from '../../database/schema'
import type { Transaction } from '../../database/client'
import { AccessDenied, requirePermission, type ActorAccess } from '../iam/access'
import { lockAdministration, ManagementConflict } from '../iam/users'
import { validateOrganizationContext } from '../governance/transaction-context'
import { allocateNumber } from '../governance/numbering'
import { bookDateInput, moneyInput, postBusinessEvent } from '../accounting/engine'

// [MBX-8][CASH-001] A cash/bank account is an operational entity bound to one ledger account.
// It is never a second ledger and never carries debit/credit rules (ADR-001, MAP-002).
export const cashAccountInput = z.object({
  unitId: z.uuid(), code: z.string().trim().regex(/^[A-Z0-9.-]{2,32}$/), name: z.string().trim().min(1).max(160),
  kind: z.enum(['cash', 'bank']), ledgerAccountId: z.uuid(),
}).strict()
const positive = moneyInput.refine(v => BigInt(v) > 0n, 'Amount must be positive')
const pageInput = z.number().int().min(1).max(1000).default(1)

export async function createCashAccount(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = cashAccountInput.parse(input)
  await lockAdministration(tx, actor, 'financial.configure')
  await validateOrganizationContext(tx, actor, data.unitId)
  const [ledger] = await tx.select({ id: ledgerAccounts.id }).from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.tenantId, actor.tenantId), eq(ledgerAccounts.id, data.ledgerAccountId), eq(ledgerAccounts.active, true)))
  if (!ledger) throw new AccessDenied('Ledger account unavailable')
  const [account] = await tx.insert(cashAccounts).values({ ...data, tenantId: actor.tenantId }).returning()
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'cash_account.created', entityId: account!.id, requestId, before: null, after: data })
  return account!
}

export async function listCashAccounts(tx: Transaction, actor: ActorAccess, query: unknown) {
  const q = z.object({ unitId: z.uuid().optional(), page: pageInput }).parse(query)
  requirePermission(actor, 'financial.read', q.unitId)
  return tx.select().from(cashAccounts)
    .where(and(eq(cashAccounts.tenantId, actor.tenantId), q.unitId ? eq(cashAccounts.unitId, q.unitId) : undefined))
    .orderBy(asc(cashAccounts.code)).limit(50).offset((q.page - 1) * 50)
}

// [MBX-8][BILL-003][PARTY-004] An AR document always names a Customer Party; an AP document
// always names a Vendor Party. Anonymous documents are not a billing concept.
export const documentInput = z.object({
  type: z.enum(['invoice', 'bill']), unitId: z.uuid(), locationId: z.uuid().nullable().default(null),
  partyId: z.uuid(), bookDate: bookDateInput, dueDate: bookDateInput, amount: positive, commandId: z.uuid(),
}).strict().refine(d => d.dueDate >= d.bookDate, 'Due date cannot precede book date')

async function requirePartyRole(tx: Transaction, actor: ActorAccess, partyId: string, unitId: string, role: 'customer' | 'vendor') {
  const [party] = await tx.select({ id: parties.id }).from(parties)
    .where(and(eq(parties.tenantId, actor.tenantId), eq(parties.id, partyId), eq(parties.active, true)))
  const [granted] = await tx.select({ id: partyRoles.id }).from(partyRoles)
    .where(and(eq(partyRoles.tenantId, actor.tenantId), eq(partyRoles.partyId, partyId), eq(partyRoles.role, role),
      sql`(${partyRoles.unitId} IS NULL OR ${partyRoles.unitId} = ${unitId}::uuid)`))
  if (!party || !granted) throw new AccessDenied(role === 'customer' ? 'Customer Party not available in Unit' : 'Vendor Party not available in Unit')
}

async function existingDocument(tx: Transaction, actor: ActorAccess, type: string, commandId: string) {
  return (await tx.select().from(financialDocuments)
    .where(and(eq(financialDocuments.tenantId, actor.tenantId), eq(financialDocuments.type, type), eq(financialDocuments.commandId, commandId))))[0]
}
async function existingPayment(tx: Transaction, actor: ActorAccess, commandId: string) {
  return (await tx.select().from(payments)
    .where(and(eq(payments.tenantId, actor.tenantId), eq(payments.commandId, commandId))))[0]
}

// [MBX-8][BILL-001][ACC-004][MAP-001..004] Outstanding is stored and only ever decreases.
// The ledger effect comes from Accounting Mapping, never from an account ID in this module.
export async function createFinancialDocument(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = documentInput.parse(input)
  await lockAdministration(tx, actor, 'financial.post', data.unitId, data.locationId || undefined)
  const retry = await existingDocument(tx, actor, data.type, data.commandId)
  if (retry) return retry
  await validateOrganizationContext(tx, actor, data.unitId, data.locationId)
  const role = data.type === 'invoice' ? 'customer' : 'vendor'
  await requirePartyRole(tx, actor, data.partyId, data.unitId, role)
  const number = await allocateNumber(tx, actor, { type: data.type, commandId: data.commandId, unitId: data.unitId, locationId: data.locationId, period: data.bookDate.slice(0, 7) }, requestId)
  const [document] = await tx.insert(financialDocuments).values({
    tenantId: actor.tenantId, type: data.type, number: number.number, commandId: data.commandId, unitId: data.unitId,
    locationId: data.locationId, partyId: data.partyId, bookDate: data.bookDate, dueDate: data.dueDate,
    amount: BigInt(data.amount), outstanding: BigInt(data.amount), status: 'open',
  }).returning()
  await tx.insert(financialDocumentEvents).values({ tenantId: actor.tenantId, documentId: document!.id, action: 'created', actorId: actor.userId, reference: number.number })
  await postBusinessEvent(tx, actor, {
    eventId: data.commandId, eventType: data.type === 'invoice' ? 'invoice_issued' : 'bill_received', schemaVersion: 1,
    bookDate: data.bookDate, unitId: data.unitId, locationId: data.locationId, partyId: data.partyId,
    partyRole: role, createsAR: data.type === 'invoice', amounts: { total: data.amount },
  }, requestId)
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'financial_document.created', entityId: document!.id, requestId,
    before: null, after: { type: data.type, number: number.number, amount: data.amount, partyId: data.partyId, dueDate: data.dueDate } })
  return document!
}

export async function listFinancialDocuments(tx: Transaction, actor: ActorAccess, query: unknown) {
  const q = z.object({ unitId: z.uuid().optional(), type: z.enum(['invoice', 'bill']).optional(),
    status: z.enum(['open', 'paid', 'void']).optional(), partyId: z.uuid().optional(), page: pageInput }).parse(query)
  requirePermission(actor, 'financial.read', q.unitId)
  return tx.select().from(financialDocuments).where(and(eq(financialDocuments.tenantId, actor.tenantId),
    q.unitId ? eq(financialDocuments.unitId, q.unitId) : undefined,
    q.type ? eq(financialDocuments.type, q.type) : undefined,
    q.status ? eq(financialDocuments.status, q.status) : undefined,
    q.partyId ? eq(financialDocuments.partyId, q.partyId) : undefined))
    .orderBy(desc(financialDocuments.bookDate), desc(financialDocuments.createdAt)).limit(50).offset((q.page - 1) * 50)
}

// [MBX-8][BILL-002] Buckets are fixed by the accepted Phase 3 decision; overdue is measured
// from the due date on the tenant calendar (the caller supplies the already-local asOf date).
export const agingBuckets = ['current', '1-30', '31-60', '61-90', '90+'] as const
export async function receivablesAging(tx: Transaction, actor: ActorAccess, query: unknown) {
  const q = z.object({ asOf: bookDateInput, type: z.enum(['invoice', 'bill']).default('invoice'), unitId: z.uuid().optional() }).parse(query)
  requirePermission(actor, 'financial.read', q.unitId)
  const rows = await tx.execute(sql`SELECT d.party_id, p.name AS party_name,
      CASE WHEN d.due_date >= ${q.asOf}::date THEN 'current'
        WHEN ${q.asOf}::date - d.due_date <= 30 THEN '1-30'
        WHEN ${q.asOf}::date - d.due_date <= 60 THEN '31-60'
        WHEN ${q.asOf}::date - d.due_date <= 90 THEN '61-90' ELSE '90+' END AS bucket,
      count(*)::int AS documents, sum(d.outstanding)::text AS outstanding
    FROM financial_documents d LEFT JOIN parties p ON p.tenant_id = d.tenant_id AND p.id = d.party_id
    WHERE d.tenant_id = ${actor.tenantId} AND d.type = ${q.type} AND d.status = 'open'
      AND (${q.unitId || null}::uuid IS NULL OR d.unit_id = ${q.unitId || null}::uuid)
    GROUP BY d.party_id, p.name, bucket ORDER BY p.name NULLS LAST, bucket`) as unknown as { party_id: string | null; party_name: string | null; bucket: string; documents: number; outstanding: string }[]
  const totals: Record<string, string> = Object.fromEntries(agingBuckets.map(bucket => [bucket, '0']))
  for (const row of rows) totals[row.bucket] = (BigInt(totals[row.bucket] ?? '0') + BigInt(row.outstanding)).toString()
  return { asOf: q.asOf, type: q.type, buckets: totals, rows: rows.map(row => ({ ...row, outstanding: String(row.outstanding) })) }
}

// [MBX-8][BILL-001/002][PAY-003] Void cancels an untouched document. Once any allocation
// exists the database guard rejects void, so correction must use refund/reversal instead.
export async function voidFinancialDocument(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = z.object({ documentId: z.uuid(), reason: z.string().trim().min(1).max(500), reference: z.string().trim().max(120).nullable().default(null) }).strict().parse(input)
  const [document] = await tx.select().from(financialDocuments).where(and(eq(financialDocuments.tenantId, actor.tenantId), eq(financialDocuments.id, data.documentId)))
  if (!document) throw new AccessDenied('Document unavailable')
  await lockAdministration(tx, actor, 'financial.post', document.unitId, document.locationId || undefined)
  if (document.status === 'void') throw new ManagementConflict('Dokumen sudah dibatalkan.')
  const [updated] = await tx.update(financialDocuments).set({ status: 'void', voidedAt: new Date(), voidedBy: actor.userId })
    .where(and(eq(financialDocuments.tenantId, actor.tenantId), eq(financialDocuments.id, document.id))).returning()
  await tx.insert(financialDocumentEvents).values({ tenantId: actor.tenantId, documentId: document.id, action: 'voided', actorId: actor.userId, reason: data.reason, reference: data.reference })
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'financial_document.voided', entityId: document.id, requestId,
    before: { status: document.status, outstanding: document.outstanding.toString() }, after: { status: 'void', reason: data.reason, reference: data.reference } })
  return updated!
}

// [MBX-8][PAY-001..003] Money in/out against one cash account, always with an identified Party.
export const paymentInput = z.object({
  direction: z.enum(['in', 'out']), unitId: z.uuid(), locationId: z.uuid().nullable().default(null),
  partyId: z.uuid(), cashAccountId: z.uuid(), bookDate: bookDateInput, amount: positive, commandId: z.uuid(),
}).strict()
export async function createPayment(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = paymentInput.parse(input)
  await lockAdministration(tx, actor, 'financial.post', data.unitId, data.locationId || undefined)
  const retry = await existingPayment(tx, actor, data.commandId)
  if (retry) return retry
  await validateOrganizationContext(tx, actor, data.unitId, data.locationId)
  const [account] = await tx.select().from(cashAccounts).where(and(eq(cashAccounts.tenantId, actor.tenantId),
    eq(cashAccounts.id, data.cashAccountId), eq(cashAccounts.unitId, data.unitId), eq(cashAccounts.active, true)))
  if (!account) throw new AccessDenied('Cash account unavailable in Unit')
  await requirePartyRole(tx, actor, data.partyId, data.unitId, data.direction === 'in' ? 'customer' : 'vendor')
  const number = await allocateNumber(tx, actor, { type: 'payment', commandId: data.commandId, unitId: data.unitId, locationId: data.locationId, period: data.bookDate.slice(0, 7) }, requestId)
  const [payment] = await tx.insert(payments).values({
    tenantId: actor.tenantId, direction: data.direction, number: number.number, commandId: data.commandId, unitId: data.unitId,
    locationId: data.locationId, partyId: data.partyId, cashAccountId: data.cashAccountId, bookDate: data.bookDate,
    amount: BigInt(data.amount), allocated: 0n, status: 'posted',
  }).returning()
  await postBusinessEvent(tx, actor, {
    eventId: data.commandId, eventType: data.direction === 'in' ? 'payment_received' : 'payment_made', schemaVersion: 1,
    bookDate: data.bookDate, unitId: data.unitId, locationId: data.locationId, partyId: data.partyId,
    partyRole: data.direction === 'in' ? 'customer' : 'vendor', createsAR: false, amounts: { total: data.amount },
  }, requestId)
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'payment.created', entityId: payment!.id, requestId,
    before: null, after: { direction: data.direction, number: number.number, amount: data.amount, cashAccountId: data.cashAccountId } })
  return payment!
}

export async function listPayments(tx: Transaction, actor: ActorAccess, query: unknown) {
  const q = z.object({ unitId: z.uuid().optional(), partyId: z.uuid().optional(), page: pageInput }).parse(query)
  requirePermission(actor, 'financial.read', q.unitId)
  return tx.select().from(payments).where(and(eq(payments.tenantId, actor.tenantId),
    q.unitId ? eq(payments.unitId, q.unitId) : undefined, q.partyId ? eq(payments.partyId, q.partyId) : undefined))
    .orderBy(desc(payments.bookDate), desc(payments.createdAt)).limit(50).offset((q.page - 1) * 50)
}

// [MBX-8][PAY-001/002] Incoming cash settles receivables; outgoing cash settles payables.
// Bounds and balance updates are enforced by the payment_allocation_guard trigger inside this
// same transaction, so a concurrent caller cannot oversell the same outstanding balance.
export async function allocatePayment(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = z.object({ paymentId: z.uuid(), documentId: z.uuid(), amount: positive }).strict().parse(input)
  const [payment] = await tx.select().from(payments).where(and(eq(payments.tenantId, actor.tenantId), eq(payments.id, data.paymentId)))
  if (!payment) throw new AccessDenied('Payment unavailable')
  await lockAdministration(tx, actor, 'financial.post', payment.unitId, payment.locationId || undefined)
  const [document] = await tx.select().from(financialDocuments).where(and(eq(financialDocuments.tenantId, actor.tenantId), eq(financialDocuments.id, data.documentId)))
  if (!document) throw new AccessDenied('Document unavailable')
  if (document.unitId !== payment.unitId) throw new AccessDenied('Payment and document must share a Unit')
  if (document.partyId !== payment.partyId) throw new AccessDenied('Payment and document must share a Party')
  if (payment.direction === 'in' ? document.type !== 'invoice' : document.type !== 'bill') throw new AccessDenied('Payment direction does not settle this document type')
  if (document.status !== 'open') throw new ManagementConflict('Dokumen tidak dalam status terbuka.')
  await tx.insert(paymentAllocations).values({ tenantId: actor.tenantId, paymentId: payment.id, documentId: document.id, amount: BigInt(data.amount), actorId: actor.userId })
  const [settled] = await tx.select({ outstanding: financialDocuments.outstanding, status: financialDocuments.status }).from(financialDocuments)
    .where(and(eq(financialDocuments.tenantId, actor.tenantId), eq(financialDocuments.id, document.id)))
  await tx.insert(financialDocumentEvents).values({ tenantId: actor.tenantId, documentId: document.id, action: settled!.status === 'paid' ? 'paid' : 'allocated',
    actorId: actor.userId, reference: payment.number })
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'payment.allocated', entityId: payment.id, requestId,
    before: { outstanding: document.outstanding.toString() }, after: { documentId: document.id, amount: data.amount, outstanding: settled!.outstanding.toString(), status: settled!.status } })
  return { documentId: document.id, amount: data.amount, outstanding: settled!.outstanding.toString(), status: settled!.status }
}
