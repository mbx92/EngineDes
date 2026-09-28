import { and, eq, inArray, lt, ne, or } from 'drizzle-orm'
import { z } from 'zod'
import { items, parties, purchaseRequests, rfqVendors, rfqs, vendorQuotations, vendorQuotationLines } from '../../database/schema'
import type { Transaction } from '../../database/client'
import { AccessDenied, readableUnits, requirePermission, type ActorAccess } from '../iam/access'

// [MBX-10][PROC-004] Vendor comparison is a read model over the quotations MBX-9 already stores. It
// deliberately owns no table, no migration and no write path: there is nothing to correct, so there
// is nothing to audit. The one guarantee it must keep is that a comparison never invents a
// historical price (PROC-004), which is why a missing history is surfaced as an explicit null
// instead of a zero or a copy of the current quote.

// [MBX-10][PROC-003] A superseded quotation is corrected history, not a live offer. Only the highest
// revision per (RFQ, Vendor) is effective, so an outdated price cannot win a comparison and a
// revised quote is not counted twice.
function highestRevisionBy<T>(rows: T[], keyOf: (row: T) => string, revisionOf: (row: T) => number): T[] {
  const best = new Map<string, T>()
  for (const row of rows) {
    const key = keyOf(row)
    const current = best.get(key)
    if (!current || revisionOf(row) > revisionOf(current)) best.set(key, row)
  }
  return [...best.values()]
}
const effectiveQuotations = <T extends { rfqId: string; partyId: string; revision: number }>(rows: T[]) =>
  highestRevisionBy(rows, row => row.rfqId + ':' + row.partyId, row => row.revision)
const effectiveHistory = <T extends { partyId: string; itemId: string; revision: number }>(rows: T[]) =>
  highestRevisionBy(rows, row => row.partyId + ':' + row.itemId, row => row.revision)

export async function compareQuotations(tx: Transaction, actor: ActorAccess, query: unknown) {
  const data = z.object({ rfqId: z.uuid() }).strict().parse(query)
  const [rfq] = await tx.select().from(rfqs)
    .where(and(eq(rfqs.tenantId, actor.tenantId), eq(rfqs.id, data.rfqId)))
  if (!rfq) throw new AccessDenied('RFQ unavailable')
  // Scope is enforced against the RFQ's own Unit, so a Unit-scoped reader cannot compare another
  // Unit's procurement and a tenant-scoped reader needs no extra parameter (IAM-001/002).
  requirePermission(actor, 'procurement.read', rfq.unitId)

  const [request] = await tx.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.tenantId, actor.tenantId), eq(purchaseRequests.id, rfq.purchaseRequestId)))

  // Every quotation raised against this RFQ, then reduced to the effective revision per Vendor.
  const quotations = await tx.select().from(vendorQuotations)
    .where(and(eq(vendorQuotations.tenantId, actor.tenantId), eq(vendorQuotations.rfqId, rfq.id)))
  const effective = effectiveQuotations(quotations)
  const effectiveIds = effective.map(row => row.id)
  const lines = effectiveIds.length
    ? await tx.select().from(vendorQuotationLines)
      .where(and(eq(vendorQuotationLines.tenantId, actor.tenantId), inArray(vendorQuotationLines.quotationId, effectiveIds)))
    : []

  const itemIds = [...new Set(lines.map(line => line.itemId))]
  const catalog = itemIds.length
    ? await tx.select().from(items).where(and(eq(items.tenantId, actor.tenantId), inArray(items.id, itemIds)))
    : []
  const itemById = new Map(catalog.map(item => [item.id, item]))

  // Vendor identity always comes from Party; the invitation set comes from the RFQ itself.
  const invitedIds = (await tx.select({ partyId: rfqVendors.partyId }).from(rfqVendors)
    .where(and(eq(rfqVendors.tenantId, actor.tenantId), eq(rfqVendors.rfqId, rfq.id)))).map(row => row.partyId)
  const vendorIds = [...new Set([...invitedIds, ...effective.map(row => row.partyId)])]
  const vendors = vendorIds.length
    ? await tx.select({ id: parties.id, name: parties.name }).from(parties)
      .where(and(eq(parties.tenantId, actor.tenantId), inArray(parties.id, vendorIds)))
    : []
  const vendorById = new Map(vendors.map(vendor => [vendor.id, vendor]))

  // [MBX-10][PROC-004] Historical price is the same Vendor's price for the same item on an *earlier*
  // RFQ. "Historical" means prior in time, not merely different: an RFQ raised later is not evidence
  // of what a vendor charged before this comparison, so a quotation that is not strictly earlier than
  // this RFQ's book date is excluded rather than presented as history. A unit-scoped reader only sees
  // Units it can read.
  const units = readableUnits(actor)
  const history = vendorIds.length && itemIds.length && (units === null || units.length)
    ? await tx.select({ partyId: vendorQuotations.partyId, itemId: vendorQuotationLines.itemId, unitPrice: vendorQuotationLines.unitPrice,
      bookDate: vendorQuotations.bookDate, createdAt: vendorQuotations.createdAt, revision: vendorQuotations.revision,
      rfqId: vendorQuotations.rfqId, quotationNumber: vendorQuotations.number })
      .from(vendorQuotationLines)
      .innerJoin(vendorQuotations, and(eq(vendorQuotations.tenantId, vendorQuotationLines.tenantId), eq(vendorQuotations.id, vendorQuotationLines.quotationId)))
      .where(and(eq(vendorQuotationLines.tenantId, actor.tenantId), inArray(vendorQuotationLines.itemId, itemIds),
        inArray(vendorQuotations.partyId, vendorIds), ne(vendorQuotations.rfqId, rfq.id),
        units === null ? undefined : inArray(vendorQuotations.unitId, units),
        or(lt(vendorQuotations.bookDate, rfq.bookDate),
          and(eq(vendorQuotations.bookDate, rfq.bookDate), lt(vendorQuotations.createdAt, rfq.createdAt)))))
    : []

  // [MBX-10][PROC-003] The history pool spans several RFQs, so it collapses per (Vendor, item) rather
  // than per (RFQ, Vendor): otherwise an old revision left in an older RFQ could win the prior price.
  // [MBX-10][PROC-004] Ordering is book date then creation order, so the newest prior price wins.
  const newestFirst = [...history].sort((a, b) => {
    if (a.bookDate !== b.bookDate) return a.bookDate < b.bookDate ? 1 : -1
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  })
  const priorByVendorItem = new Map<string, typeof history[number]>()
  for (const row of effectiveHistory(newestFirst)) {
    const key = row.partyId + ':' + row.itemId
    if (!priorByVendorItem.has(key)) priorByVendorItem.set(key, row)
  }

  const serializeVendor = (partyId: string) => {
    const quotation = effective.find(row => row.partyId === partyId)
    const vendorLines = quotation ? lines.filter(line => line.quotationId === quotation.id) : []
    // [MBX-10][PROC-004] The schema only forbids a repeated line number, so one quotation may carry
    // two lines for the same item. Grouping by item keeps the cell, the vendor total and the cheapest
    // marker consistent; a mixed rate is reported as mixed instead of silently picking one line.
    const grouped = new Map<string, { quantity: bigint; amount: bigint; prices: Set<string> }>()
    for (const line of vendorLines) {
      const group = grouped.get(line.itemId) || { quantity: 0n, amount: 0n, prices: new Set<string>() }
      group.quantity += line.quantity
      group.amount += line.quantity * line.unitPrice
      group.prices.add(line.unitPrice.toString())
      grouped.set(line.itemId, group)
    }
    let total = 0n
    const offers = itemIds.map(itemId => {
      const group = grouped.get(itemId)
      if (!group) return { itemId, quantity: null, unitPrice: null, amount: null, mixedRate: false, historicalUnitPrice: null,
        historicalQuotationNumber: null, historicalBookDate: null, priceDelta: null, priceDeltaPct: null }
      total += group.amount
      const unitPrice = group.prices.size === 1 ? [...group.prices][0]! : null
      const prior = priorByVendorItem.get(partyId + ':' + itemId)
      // [MBX-10][PROC-004] The delta is only meaningful when a real prior price exists. With no
      // history, or with a mixed rate that has no single price, both deltas stay null.
      const current = unitPrice === null ? null : BigInt(unitPrice)
      const priceDelta = prior && current !== null ? (current - prior.unitPrice).toString() : null
      const priceDeltaPct = prior && current !== null && prior.unitPrice > 0n
        ? Number(((current - prior.unitPrice) * 10000n) / prior.unitPrice) / 100
        : null
      return { itemId, quantity: group.quantity.toString(), unitPrice, amount: group.amount.toString(),
        mixedRate: group.prices.size > 1,
        historicalUnitPrice: prior ? prior.unitPrice.toString() : null,
        historicalQuotationNumber: prior ? prior.quotationNumber : null,
        historicalBookDate: prior ? prior.bookDate : null, priceDelta, priceDeltaPct }
    })
    const priced = offers.filter(offer => offer.unitPrice !== null).length
    return { partyId, name: vendorById.get(partyId)?.name || 'Vendor', invited: invitedIds.includes(partyId),
      total: quotation ? total.toString() : null, itemsPriced: priced, itemsMissing: itemIds.length - grouped.size,
      itemsMixed: offers.filter(offer => offer.mixedRate).length,
      quotation: quotation ? { id: quotation.id, number: quotation.number, revision: quotation.revision, bookDate: quotation.bookDate,
        validUntil: quotation.validUntil, paymentTerm: quotation.paymentTerm, deliveryDays: quotation.deliveryDays,
        revisionCount: quotations.filter(row => row.partyId === partyId).length } : null,
      offers }
  }

  // [MBX-10][PROC-002] An invited Vendor without a quotation still appears, with every cell empty:
  // "belum menawar" is a comparison fact, not a reason to drop the row.
  const vendorRows = vendorIds.map(serializeVendor)

  const comparisonItems = itemIds.map(itemId => {
    const item = itemById.get(itemId)
    const priced = vendorRows
      .map(vendor => ({ partyId: vendor.partyId, unitPrice: vendor.offers.find(offer => offer.itemId === itemId)?.unitPrice || null }))
      .filter((row): row is { partyId: string; unitPrice: string } => row.unitPrice !== null)
    const lowest = priced.reduce<bigint | null>((min, row) => {
      const value = BigInt(row.unitPrice)
      return min === null || value < min ? value : min
    }, null)
    return { itemId, code: item?.code || '—', name: item?.name || 'Item', uom: item?.uom || '—',
      cheapestUnitPrice: lowest === null ? null : lowest.toString(),
      // Ties are all marked cheapest: with equal prices there is no single winner to claim.
      cheapestPartyIds: lowest === null ? [] : priced.filter(row => BigInt(row.unitPrice) === lowest).map(row => row.partyId) }
  })

  const totals = vendorRows.filter((vendor): vendor is typeof vendor & { total: string } => vendor.total !== null)
  const lowestTotal = totals.reduce<bigint | null>((min, vendor) => {
    const value = BigInt(vendor.total)
    return min === null || value < min ? value : min
  }, null)

  return {
    rfq: { id: rfq.id, number: rfq.number, unitId: rfq.unitId, bookDate: rfq.bookDate, note: rfq.note },
    purchaseRequest: request ? { id: request.id, number: request.number, justification: request.justification, status: request.status } : null,
    items: comparisonItems,
    vendors: vendorRows,
    summary: { vendors: vendorRows.length, quoted: totals.length,
      revisions: quotations.filter(row => row.revision > 1).length,
      lowestTotal: lowestTotal === null ? null : lowestTotal.toString(),
      lowestTotalPartyIds: lowestTotal === null ? [] : totals.filter(vendor => BigInt(vendor.total) === lowestTotal).map(vendor => vendor.partyId),
      // PROC-004 requires the absence of history to be stated, not implied by an empty column.
      hasHistoricalPrices: vendorRows.some(vendor => vendor.offers.some(offer => offer.historicalUnitPrice !== null)),
      // The anchor makes "history" auditable from the response itself: only prices strictly before
      // this date can appear in a historical column.
      historicalAnchorDate: rfq.bookDate },
  }
}
