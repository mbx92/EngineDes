import { and, asc, desc, eq, or, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { items, rfqs, rfqVendors, purchaseRequests, purchaseRequestLines, vendorQuotations, vendorQuotationLines, parties, partyRoles, auditEvents } from '../../database/schema'
import type { Transaction } from '../../database/client'
import { AccessDenied, requirePermission, type ActorAccess } from '../iam/access'
import { lockAdministration, ManagementConflict } from '../iam/users'
import { bookDateInput, moneyInput } from '../accounting/engine'
import { allocateNumber } from '../governance/numbering'
import { validateOrganizationContext } from '../governance/transaction-context'

// [MBX-9][PROC-001..003] Procurement is pre-financial: nothing here posts a journal, holds an
// account ID, or configures an Accounting Mapping (ADR-001/003, MAP-001..004). The first ledger
// effect stays at Vendor Bill (PROC-007 / MBX-11). Approval policy (WF-001, IAM-003) is also
// MBX-11, so PR status deliberately stops at `submitted` rather than pretending to be approved.
const pageInput = z.number().int().min(1).max(1000).default(1)
const quantity = moneyInput.refine(v => BigInt(v) > 0n, 'Quantity must be positive')
const priceInput = moneyInput.refine(v => BigInt(v) > 0n, 'Price must be positive')
const codeInput = z.string().trim().regex(/^[A-Z0-9.-]{2,40}$/)
const requestLines = z.array(z.object({ itemId: z.uuid(), quantity }).strict()).min(1).max(100)
const quotationLines = z.array(z.object({ itemId: z.uuid(), quantity, unitPrice: priceInput }).strict()).min(1).max(100)

// [MBX-9][PROC-004] BigInt cannot cross a JSON boundary, so every quantity, price and total leaves
// this module as an exact string, matching the money contract used elsewhere in the platform.
const serializeRequestLine = (line: typeof purchaseRequestLines.$inferSelect) => ({ ...line, quantity: line.quantity.toString() })
const serializeQuotationLine = (line: typeof vendorQuotationLines.$inferSelect) =>
  ({ ...line, quantity: line.quantity.toString(), unitPrice: line.unitPrice.toString() })

// [MBX-9][PROC-001][PROC-003] An item must exist and be visible to the requesting Unit: a
// BUMDes-level item is shared across Unit Usaha, a Unit-owned item is only usable inside that Unit.
async function requireItem(tx: Transaction, actor: ActorAccess, itemId: string, unitId: string) {
  const [item] = await tx.select({ id: items.id }).from(items)
    .where(and(eq(items.tenantId, actor.tenantId), eq(items.id, itemId), eq(items.active, true),
      or(isNull(items.unitId), eq(items.unitId, unitId))))
  if (!item) throw new AccessDenied('Item unavailable for Unit')
}

// [MBX-9][PROC-002] RFQ invitees and quotation authors must be real Vendor Parties. This mirrors
// the AR/AP rule that Vendor is a Party role, so identity is never duplicated (PARTY-002).
async function requireVendor(tx: Transaction, actor: ActorAccess, partyId: string, unitId: string) {
  const [party] = await tx.select({ id: parties.id }).from(parties)
    .where(and(eq(parties.tenantId, actor.tenantId), eq(parties.id, partyId), eq(parties.active, true)))
  const [role] = await tx.select({ id: partyRoles.id }).from(partyRoles)
    .where(and(eq(partyRoles.tenantId, actor.tenantId), eq(partyRoles.partyId, partyId), eq(partyRoles.role, 'vendor'),
      sql`(${partyRoles.unitId} IS NULL OR ${partyRoles.unitId} = ${unitId}::uuid)`))
  if (!party || !role) throw new AccessDenied('Vendor Party not available in Unit')
}

async function readRequestLines(tx: Transaction, actor: ActorAccess, purchaseRequestId: string) {
  const rows = await tx.select().from(purchaseRequestLines)
    .where(and(eq(purchaseRequestLines.tenantId, actor.tenantId), eq(purchaseRequestLines.purchaseRequestId, purchaseRequestId)))
    .orderBy(asc(purchaseRequestLines.lineNo))
  return rows.map(serializeRequestLine)
}

async function readRfqVendors(tx: Transaction, actor: ActorAccess, rfqId: string) {
  return (await tx.select({ partyId: rfqVendors.partyId }).from(rfqVendors)
    .where(and(eq(rfqVendors.tenantId, actor.tenantId), eq(rfqVendors.rfqId, rfqId)))).map(row => row.partyId)
}

async function readQuotationLines(tx: Transaction, actor: ActorAccess, quotationId: string) {
  const rows = await tx.select().from(vendorQuotationLines)
    .where(and(eq(vendorQuotationLines.tenantId, actor.tenantId), eq(vendorQuotationLines.quotationId, quotationId)))
    .orderBy(asc(vendorQuotationLines.lineNo))
  return rows.map(serializeQuotationLine)
}

// [MBX-9][PROC-001] Item/service master data is controlled master data (CFG-001), so creating it
// is an administrative action, like creating a Party. It defaults to BUMDes-level so vendor price
// history can span Unit Usaha, but a Unit-owned item stays private to that Unit.
export async function createItem(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = z.object({ unitId: z.uuid().nullable().default(null), code: codeInput, name: z.string().trim().min(1).max(160),
    kind: z.enum(['item', 'service']), uom: z.string().trim().min(1).max(20) }).strict().parse(input)
  await lockAdministration(tx, actor, 'configuration.manage', data.unitId || undefined)
  if (data.unitId) await validateOrganizationContext(tx, actor, data.unitId)
  const [item] = await tx.insert(items).values({ ...data, tenantId: actor.tenantId, actorId: actor.userId }).returning()
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'item.created', entityId: item!.id, requestId, before: null, after: data })
  return item!
}

export async function listItems(tx: Transaction, actor: ActorAccess, query: unknown) {
  const q = z.object({ unitId: z.uuid().optional(), kind: z.enum(['item', 'service']).optional(), page: pageInput }).parse(query)
  requirePermission(actor, 'procurement.read', q.unitId)
  return tx.select().from(items)
    .where(and(eq(items.tenantId, actor.tenantId),
      q.unitId ? or(isNull(items.unitId), eq(items.unitId, q.unitId)) : undefined,
      q.kind ? eq(items.kind, q.kind) : undefined))
    .orderBy(asc(items.code)).limit(50).offset((q.page - 1) * 50)
}

// [MBX-9][PROC-001][SEQ-001][AUDIT-001] A Purchase Request with its lines, numbered from configured
// sequencing and written entirely inside the caller's transaction.
export async function createPurchaseRequest(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = z.object({ unitId: z.uuid(), locationId: z.uuid().nullable().default(null), bookDate: bookDateInput,
    justification: z.string().trim().min(1).max(1000), lines: requestLines, commandId: z.uuid() }).strict().parse(input)
  await lockAdministration(tx, actor, 'purchase_request.create', data.unitId, data.locationId || undefined)
  const retry = (await tx.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.tenantId, actor.tenantId), eq(purchaseRequests.commandId, data.commandId))))[0]
  if (retry) return { ...retry, lines: await readRequestLines(tx, actor, retry.id) }
  await validateOrganizationContext(tx, actor, data.unitId, data.locationId)
  for (const line of data.lines) await requireItem(tx, actor, line.itemId, data.unitId)
  const number = await allocateNumber(tx, actor, { type: 'purchase_request', commandId: data.commandId, unitId: data.unitId, locationId: data.locationId, period: data.bookDate.slice(0, 7) }, requestId)
  const [request] = await tx.insert(purchaseRequests).values({ tenantId: actor.tenantId, number: number.number, commandId: data.commandId,
    unitId: data.unitId, locationId: data.locationId, requestedBy: actor.userId, bookDate: data.bookDate,
    justification: data.justification, status: 'draft' }).returning()
  await tx.insert(purchaseRequestLines).values(data.lines.map((line, index) => ({ tenantId: actor.tenantId, purchaseRequestId: request!.id,
    lineNo: index + 1, itemId: line.itemId, quantity: BigInt(line.quantity) })))
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'purchase_request.created', entityId: request!.id, requestId,
    before: null, after: { number: number.number, unitId: data.unitId, justification: data.justification, lines: data.lines.length } })
  return { ...request!, lines: await readRequestLines(tx, actor, request!.id) }
}

// [MBX-9][PROC-001] Submitting is the last state this slice owns. The submitter and time are stored
// so MBX-11 can gate approval without re-deriving who raised the request.
export async function submitPurchaseRequest(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = z.object({ purchaseRequestId: z.uuid() }).strict().parse(input)
  const [request] = await tx.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.tenantId, actor.tenantId), eq(purchaseRequests.id, data.purchaseRequestId)))
  if (!request) throw new AccessDenied('Purchase Request unavailable')
  await lockAdministration(tx, actor, 'purchase_request.create', request.unitId, request.locationId || undefined)
  if (request.status !== 'draft') throw new ManagementConflict('Hanya draft Purchase Request yang dapat diajukan.')
  const [submitted] = await tx.update(purchaseRequests).set({ status: 'submitted', submittedAt: new Date(), submittedBy: actor.userId })
    .where(and(eq(purchaseRequests.tenantId, actor.tenantId), eq(purchaseRequests.id, request.id))).returning()
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'purchase_request.submitted', entityId: request.id, requestId,
    before: { status: request.status }, after: { status: 'submitted' } })
  return { ...submitted!, lines: await readRequestLines(tx, actor, request.id) }
}

export async function listPurchaseRequests(tx: Transaction, actor: ActorAccess, query: unknown) {
  const q = z.object({ unitId: z.uuid().optional(), status: z.enum(['draft', 'submitted']).optional(), page: pageInput }).parse(query)
  requirePermission(actor, 'procurement.read', q.unitId)
  const rows = await tx.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.tenantId, actor.tenantId),
      q.unitId ? eq(purchaseRequests.unitId, q.unitId) : undefined,
      q.status ? eq(purchaseRequests.status, q.status) : undefined))
    .orderBy(desc(purchaseRequests.bookDate), desc(purchaseRequests.createdAt)).limit(50).offset((q.page - 1) * 50)
  const result = []
  for (const row of rows) result.push({ ...row, lines: await readRequestLines(tx, actor, row.id) })
  return result
}

// [MBX-9][PROC-002] One RFQ addressed to several Vendors, raised from a submitted PR. Vendors can
// still be added later, so the invitation set can widen without rewriting the RFQ.
export async function createRfq(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = z.object({ purchaseRequestId: z.uuid(), bookDate: bookDateInput, vendorIds: z.array(z.uuid()).min(1).max(50),
    note: z.string().trim().max(1000).nullable().default(null), commandId: z.uuid() }).strict()
    .refine(v => new Set(v.vendorIds).size === v.vendorIds.length, 'Duplicate vendors').parse(input)
  const [request] = await tx.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.tenantId, actor.tenantId), eq(purchaseRequests.id, data.purchaseRequestId)))
  if (!request) throw new AccessDenied('Purchase Request unavailable')
  await lockAdministration(tx, actor, 'rfq.create', request.unitId, request.locationId || undefined)
  const retry = (await tx.select().from(rfqs)
    .where(and(eq(rfqs.tenantId, actor.tenantId), eq(rfqs.commandId, data.commandId))))[0]
  if (retry) return { ...retry, vendorIds: await readRfqVendors(tx, actor, retry.id) }
  if (request.status !== 'submitted') throw new ManagementConflict('RFQ membutuhkan Purchase Request berstatus submitted.')
  for (const vendorId of data.vendorIds) await requireVendor(tx, actor, vendorId, request.unitId)
  const number = await allocateNumber(tx, actor, { type: 'rfq', commandId: data.commandId, unitId: request.unitId, locationId: request.locationId, period: data.bookDate.slice(0, 7) }, requestId)
  const [rfq] = await tx.insert(rfqs).values({ tenantId: actor.tenantId, number: number.number, commandId: data.commandId,
    purchaseRequestId: request.id, unitId: request.unitId, bookDate: data.bookDate, note: data.note, actorId: actor.userId }).returning()
  await tx.insert(rfqVendors).values(data.vendorIds.map(partyId => ({ tenantId: actor.tenantId, rfqId: rfq!.id, partyId })))
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'rfq.created', entityId: rfq!.id, requestId,
    before: null, after: { number: number.number, purchaseRequestId: request.id, vendors: data.vendorIds.length } })
  return { ...rfq!, vendorIds: data.vendorIds }
}

export async function addRfqVendors(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = z.object({ rfqId: z.uuid(), vendorIds: z.array(z.uuid()).min(1).max(50) }).strict()
    .refine(v => new Set(v.vendorIds).size === v.vendorIds.length, 'Duplicate vendors').parse(input)
  const [rfq] = await tx.select().from(rfqs).where(and(eq(rfqs.tenantId, actor.tenantId), eq(rfqs.id, data.rfqId)))
  if (!rfq) throw new AccessDenied('RFQ unavailable')
  await lockAdministration(tx, actor, 'rfq.create', rfq.unitId)
  for (const vendorId of data.vendorIds) await requireVendor(tx, actor, vendorId, rfq.unitId)
  const existing = await readRfqVendors(tx, actor, rfq.id)
  const added = data.vendorIds.filter(vendorId => !existing.includes(vendorId))
  if (added.length) await tx.insert(rfqVendors).values(added.map(partyId => ({ tenantId: actor.tenantId, rfqId: rfq.id, partyId })))
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'rfq.vendors_added', entityId: rfq.id, requestId,
    before: { vendors: existing.length }, after: { vendors: existing.length + added.length } })
  return { ...rfq, vendorIds: [...existing, ...added] }
}

export async function listRfqs(tx: Transaction, actor: ActorAccess, query: unknown) {
  const q = z.object({ unitId: z.uuid().optional(), purchaseRequestId: z.uuid().optional(), page: pageInput }).parse(query)
  requirePermission(actor, 'procurement.read', q.unitId)
  const rows = await tx.select().from(rfqs)
    .where(and(eq(rfqs.tenantId, actor.tenantId),
      q.unitId ? eq(rfqs.unitId, q.unitId) : undefined,
      q.purchaseRequestId ? eq(rfqs.purchaseRequestId, q.purchaseRequestId) : undefined))
    .orderBy(desc(rfqs.bookDate), desc(rfqs.createdAt)).limit(50).offset((q.page - 1) * 50)
  const result = []
  for (const row of rows) result.push({ ...row, vendorIds: await readRfqVendors(tx, actor, row.id) })
  return result
}

// [MBX-9][PROC-003] A quotation stores commercial terms per Vendor and item. A correction inserts a
// new revision naming the one it supersedes, so a quoted price is never rewritten in place.
export async function createQuotation(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = z.object({ rfqId: z.uuid(), partyId: z.uuid(), bookDate: bookDateInput, validUntil: bookDateInput.nullable().default(null),
    paymentTerm: z.string().trim().max(160).nullable().default(null), deliveryDays: z.number().int().min(1).max(3650).nullable().default(null),
    lines: quotationLines, supersedesId: z.uuid().nullable().default(null), commandId: z.uuid() }).strict().parse(input)
  const [rfq] = await tx.select().from(rfqs).where(and(eq(rfqs.tenantId, actor.tenantId), eq(rfqs.id, data.rfqId)))
  if (!rfq) throw new AccessDenied('RFQ unavailable')
  await lockAdministration(tx, actor, 'quotation.create', rfq.unitId)
  const retry = (await tx.select().from(vendorQuotations)
    .where(and(eq(vendorQuotations.tenantId, actor.tenantId), eq(vendorQuotations.commandId, data.commandId))))[0]
  if (retry) return { ...retry, lines: await readQuotationLines(tx, actor, retry.id) }
  await requireVendor(tx, actor, data.partyId, rfq.unitId)
  // A vendor may only quote an RFQ it was actually invited to (PROC-002 -> PROC-003 continuity).
  const invited = await readRfqVendors(tx, actor, rfq.id)
  if (!invited.includes(data.partyId)) throw new ManagementConflict('Vendor belum diundang pada RFQ ini.')
  for (const line of data.lines) await requireItem(tx, actor, line.itemId, rfq.unitId)
  let revision = 1
  if (data.supersedesId) {
    const [prior] = await tx.select().from(vendorQuotations).where(and(eq(vendorQuotations.tenantId, actor.tenantId), eq(vendorQuotations.id, data.supersedesId)))
    if (!prior || prior.rfqId !== rfq.id || prior.partyId !== data.partyId) throw new ManagementConflict('Revisi harus menggantikan quotation vendor yang sama pada RFQ yang sama.')
    revision = prior.revision + 1
  }
  const number = await allocateNumber(tx, actor, { type: 'vendor_quotation', commandId: data.commandId, unitId: rfq.unitId, locationId: null, period: data.bookDate.slice(0, 7) }, requestId)
  const [quotation] = await tx.insert(vendorQuotations).values({ tenantId: actor.tenantId, number: number.number, commandId: data.commandId,
    rfqId: rfq.id, partyId: data.partyId, unitId: rfq.unitId, bookDate: data.bookDate, validUntil: data.validUntil,
    paymentTerm: data.paymentTerm, deliveryDays: data.deliveryDays, revision, supersedesId: data.supersedesId, actorId: actor.userId }).returning()
  await tx.insert(vendorQuotationLines).values(data.lines.map((line, index) => ({ tenantId: actor.tenantId, quotationId: quotation!.id,
    lineNo: index + 1, itemId: line.itemId, quantity: BigInt(line.quantity), unitPrice: BigInt(line.unitPrice) })))
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, action: 'vendor_quotation.created', entityId: quotation!.id, requestId,
    before: data.supersedesId ? { supersedesId: data.supersedesId } : null,
    after: { number: number.number, rfqId: rfq.id, partyId: data.partyId, revision, lines: data.lines.length } })
  return { ...quotation!, lines: await readQuotationLines(tx, actor, quotation!.id) }
}

export async function listQuotations(tx: Transaction, actor: ActorAccess, query: unknown) {
  const q = z.object({ rfqId: z.uuid().optional(), partyId: z.uuid().optional(), unitId: z.uuid().optional(), page: pageInput }).parse(query)
  requirePermission(actor, 'procurement.read', q.unitId)
  const rows = await tx.select().from(vendorQuotations)
    .where(and(eq(vendorQuotations.tenantId, actor.tenantId),
      q.rfqId ? eq(vendorQuotations.rfqId, q.rfqId) : undefined,
      q.partyId ? eq(vendorQuotations.partyId, q.partyId) : undefined,
      q.unitId ? eq(vendorQuotations.unitId, q.unitId) : undefined))
    .orderBy(desc(vendorQuotations.bookDate), desc(vendorQuotations.createdAt)).limit(50).offset((q.page - 1) * 50)
  const result = []
  for (const row of rows) {
    const lines = await readQuotationLines(tx, actor, row.id)
    const total = lines.reduce((sum, line) => sum + BigInt(line.quantity) * BigInt(line.unitPrice), 0n)
    result.push({ ...row, lines, total: total.toString() })
  }
  return result
}
