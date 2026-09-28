# MBX-10 — Vendor comparison (PROC-004)

Requirements: PROC-004, PROC-002, PROC-003, IAM-001/002, NFR-SEC-002. Sources: Notion Functional Requirements v0.1, P0 Acceptance Criteria v0.1, the Phase 4 section of the Delivery Agreement & Decision Register, and Linear MBX-10.

## Scope

This slice delivers the side-by-side vendor comparison PROC-004 asks for: item price, total, delivery, payment terms and historical price, with the absence of history represented explicitly.

Delivered: `server/core/procurement/comparison.ts`, the read-only route `GET /api/tenants/[tenantId]/procurement/comparison?rfqId=`, a "Perbandingan Vendor" tab in `ProcurementPanel.vue`, and PostgreSQL acceptance coverage.

**No table, no migration and no write path.** A comparison is a computed view over the quotations MBX-9 already stores. Because there is nothing to correct, there is nothing to audit, so AUDIT-001 imposes no new obligation here and the slice adds no append-only trail. It is deliberately a `GET` with no mutation route.

Not delivered, and not claimed: award/selection (`MBX-11` owns PO issuance), weighted scoring, and any persisted comparison document. The comparison never becomes a document of record, so it cannot drift from the quotations it reads.

## Effective revision (PROC-003)

A superseded quotation is corrected history, not a live offer. Only the highest revision per (RFQ, Vendor) is effective, so an outdated price cannot win a comparison and a revised quote is not counted twice. The comparison reports `revision` and `revisionCount` so a reader can see that a price was corrected and how many times.

The same collapse is applied to the history pool, but grouped per (Vendor, item) instead of per (RFQ, Vendor): the pool spans several RFQs, and grouping by RFQ would let an old revision left in an older RFQ win the prior price.

## Historical price (PROC-004)

Historical price means the same Vendor's price for the same item on an **earlier** RFQ. "Historical" is taken literally as *prior in time*, anchored on the compared RFQ: a quotation is only eligible when

```sql
(quotation.book_date < rfq.book_date)
OR (quotation.book_date = rfq.book_date AND quotation.created_at < rfq.created_at)
```

A merely *different* RFQ is not evidence — an RFQ raised later says nothing about what a vendor charged before this comparison. The current RFQ is excluded outright, because its own revisions are the live offer. The newest eligible prior price wins, ordered by book date then creation order. A unit-scoped reader only sees prices from Units it is allowed to read.

When no evidence exists the response states it rather than leaving it to inference:

- `historicalUnitPrice`, `historicalBookDate`, `historicalQuotationNumber` are `null`;
- `priceDelta` and `priceDeltaPct` are `null` — never `0`, which would falsely read as "no change";
- the row sets `hasHistoricalPrices` and exposes `historicalAnchorDate`, so "history only comes from before this date" is auditable from the response itself;
- the UI prints "tanpa riwayat harga" per cell and a summary note when no vendor has any history.

## Prices, totals and ties

- **Item cell.** Price per item plus the vendor's line quantity. When a quotation carries two lines for the same item — the schema's uniqueness is on line number, not on item — the cell reports a **mixed rate**: no single price is shown, the item is excluded from the cheapest marker, and the line total is displayed instead. The vendor's total still sums every line, so the cell and the total cannot disagree.
- **Vendor total.** Sum of all effective priced lines. `itemsPriced`, `itemsMissing` and `itemsMixed` make partial quotes legible.
- **Delivery and payment terms.** `deliveryDays` and `paymentTerm` are shown in the vendor column header, which is where PROC-004 places them in a side-by-side layout.
- **Cheapest item and lowest total.** Both are computed and marked. Ties mark *every* tied vendor rather than picking one arbitrarily: with equal prices there is no single winner to claim.
- **Invited but silent.** An invited Vendor with no quotation still appears, with every cell empty and `quotation: null`. "Belum menawar" is a comparison fact, not a reason to drop the row.

## Isolation and serialization

- Scope is resolved from the RFQ's own Unit, so a Unit-scoped reader compares without passing a `unitId` and cannot compare another Unit's procurement. A foreign tenant's RFQ surfaces as "unavailable" instead of leaking its existence.
- `requirePermission(actor, 'procurement.read', rfq.unitId)` mirrors every other procurement read.
- Every amount leaves the module as an exact string. A raw `bigint` cannot cross the JSON boundary, so the acceptance test asserts `JSON.stringify` of the whole comparison does not throw and contains no bigint literal — the failure mode is caught in test rather than as a 500 in production.

## Local verification and QA

Run `corepack pnpm test:postgres`, `corepack pnpm typecheck`, `corepack pnpm build` and `corepack pnpm test:artifact`.

The comparison acceptance test is guarded by `TEST_DATABASE_URL` for consistency with the procurement suite. Coverage includes: effective-revision selection with a superseded quote that must not win; invited-but-silent vendor; historical price with a signed delta and percentage, including a decrease; the explicit absence of history on an RFQ with no earlier evidence; the `historicalAnchorDate`; a later RFQ that must not be treated as history; item- and total-level cheapest markers with ties; the mixed-rate case that cannot claim a single price or the cheapest marker; a tenant-scoped reader needing no Unit parameter; cross-tenant refusal; and JSON serialization of the full response.

`tests/http.test.ts` asserts the comparison read returns 401 without a session and that no mutation route exists for it.

## Out of scope

Award/selection, weighted scoring and any stored comparison snapshot remain open. PO issuance is MBX-11, and it is the first place procurement reaches the ledger — this slice still posts nothing, holds no account ID and configures no Accounting Mapping (ADR-001/003, MAP-001..004).
