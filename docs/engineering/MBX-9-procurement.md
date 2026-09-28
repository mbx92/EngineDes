# MBX-9 — Phase 4 procurement: Purchase Request, RFQ and Vendor Quotation

Requirements: PROC-001, PROC-002, PROC-003, PROC-004, PARTY-002, ORG-001/003, IAM-001/002, AUDIT-001, CFG-001, SEQ-001, NFR-SEC-002, NFR-DATA-002. Sources: Notion Functional Requirements v0.1, P0 Acceptance Criteria v0.1, Domain Model & Master Data, ADR-001/003/008/009, the Phase 4 section of the Delivery Agreement & Decision Register, and Linear MBX-9.

## Scope

This slice delivers the pre-financial half of procurement: controlled item/service master data, a Purchase Request that can be raised and submitted, an RFQ addressed to several Vendor Parties, and per-Vendor quotations with commercial terms and append-only revisions.

Delivered: migration `0013` (seven tables, forced RLS, least-privilege grants, immutability and workflow guards), `server/core/procurement/procurement.ts`, HTTP routes under `server/api/tenants/[tenantId]/procurement/`, the `ProcurementPanel.vue` surface wired into the shell, demo seed data, and PostgreSQL acceptance coverage.

Not yet delivered, and not claimed: Purchase Orders, Goods Receipt and Vendor Bills (PROC-005..007), the first ledger effect, quotation comparison and award (PROC-004 scoring), and approval rules (WF-001, IAM-003). This slice is deliberately pre-financial: nothing here posts a journal, holds an account ID, or configures an Accounting Mapping (ADR-001/003, MAP-001..004). The first ledger effect stays at Vendor Bill in MBX-11.

## Item master data (PROC-001, PROC-004, CFG-001)

Item/service master data is controlled master data and is created under `configuration.manage` — the same authority that configures the chart of accounts and cash accounts — so the Admin role writes it and business roles read it. An item carries `code`, `name`, `kind` (`item` | `service`) and a unit of measure.

`unit_id` is nullable and defaults to `null`, meaning BUMDes-level. That default is the whole point of PROC-004: vendor comparison and vendor price history must be able to span Unit Usaha, which is impossible if every item is owned by one Unit. A Unit-owned item stays private to that Unit, and `requireItem` enforces the visibility rule on read *and* on every write:

```sql
(unit_id IS NULL OR unit_id = <requesting unit>)
```

A request line therefore cannot cite an item the requesting Unit cannot see, and an unknown or inactive item is refused rather than silently accepted as free text.

## Purchase Request (PROC-001, SEQ-001, AUDIT-001)

A PR stores Unit (with an optional Location), book date, justification, its item/service lines with quantity, the requesting actor, and a status that this slice bounds to `draft` and `submitted`. It is numbered from configured sequencing (`sequence:purchase_request`), so the prefix and reset policy stay configuration rather than code.

Only the `draft -> submitted` transition exists. Submitting records `submittedBy` and `submittedAt` so MBX-11 can gate approval without re-deriving who raised the request. Approval is explicitly *not* modelled here: inventing an approval state now would have been an undocumented product rule.

A replayed `commandId` returns the stored request instead of allocating a second number, the same idempotency contract document and payment creation already follow.

## RFQ (PROC-002, PARTY-002)

An RFQ is raised from a PR and is addressed to one or more Vendor Parties. It refuses to be created unless the PR is already `submitted`, and every invitee must be an active Party that actually holds an active `vendor` role visible to the RFQ's Unit:

```sql
party_role.role = 'vendor' AND (party_role.unit_id IS NULL OR party_role.unit_id = <rfq unit>)
```

Vendor stays a Party role, not a duplicate identity table (PARTY-002). Invitees can still be added to an existing RFQ, because widening an invitation set is a legitimate later action; the insert is append-only and adding an already-invited vendor is idempotent.

## Vendor Quotation (PROC-003, PROC-004)

A quotation holds, per Vendor, the priced lines plus the commercial terms the comparison needs: `paymentTerm`, `deliveryDays`, `validUntil`. A vendor may only quote an RFQ it was actually invited to, which keeps the RFQ → quotation trail continuous rather than assumed.

Correction is append-only. A revised quotation increments `revision` and names the row it `supersedesId`, and the superseded row is never rewritten — so a quoted price keeps its history. The same rule is enforced in Core and by the `vendor_quotation_vendor_guard` trigger, which also rejects a revision that tries to supersede a different vendor or a different RFQ. Quantities, prices and totals leave the module as exact strings, matching the money contract used elsewhere, because a raw `bigint` cannot cross a JSON boundary.

## Guards and isolation (AUDIT-001, NFR-SEC-002, NFR-DATA-002)

- **Forced RLS** on all seven tables. Runtime grants are append-only: `SELECT, INSERT` on `items`, lines, RFQs, invitees and quotations; `SELECT, INSERT, UPDATE` only on `purchase_requests`, and only because submitting moves a stored status.
- **Immutability.** `procurement_prevent_change` blocks `UPDATE`/`DELETE` on `items`, `rfqs`, `rfq_vendors`, `vendor_quotations` and both line tables. `purchase_request_guard` allows only the `draft -> submitted` move and keeps every other fact — number, command ID, Unit, Location, requester, book date, justification — immutable.
- **Lines belong to their header.** `procurement_line_guard` requires the parent row to have been inserted by the same transaction (`xmin = txid_current()`), so lines can never be appended to a stored document. RFQ invitees are deliberately excluded, since adding vendors later is a valid business action.
- **Tenant isolation** makes a foreign PR surface as "unavailable" rather than leaking its existence, and a foreign tenant sees none of these tables through RLS.

## IAM

A `procurement` role was added alongside four permissions: `procurement.read`, `purchase_request.create`, `rfq.create` and `quotation.create`. A unit-scoped procurement grant raises requests inside its assigned Unit and is refused outside it. Reading is Unit-scoped too, which is why the panel always sends a Unit it is actually assigned to:

```ts
const scoped = filterUnit.value ? { unitId: filterUnit.value } : {}
```

`access.get.ts` exposes `canReadProcurement`, `canCreatePurchaseRequest`, `canManageRfq`, `canQuoteProcurement` and `canManageItems`, mirroring the billing boundary where Admin configures while operational roles transact.

## HTTP boundary and UI

Routes under `server/api/tenants/[tenantId]/procurement/`: `GET/POST items`, `GET/POST purchase-requests`, `POST purchase-requests/submit`, `GET/POST rfqs`, `POST rfqs/vendors`, `GET/POST quotations`. Reads are `no-store` and permission-checked in Core; mutations enforce same-origin then resolve the actor through `authenticated`. Tenant scope comes only from the path plus the session, never from the body.

`ProcurementPanel.vue` exposes four tabs — requests, RFQ, quotations and items — with a Unit filter, and revalidates against the server on every mutation. A refused command surfaces the authored 409 message instead of a generic failure.

## Local verification and QA

Run `corepack pnpm test:postgres`, `corepack pnpm typecheck`, `corepack pnpm build` and `corepack pnpm test:artifact`.

The procurement acceptance test is guarded by `TEST_DATABASE_URL` because its guarantees are database triggers, which the PGlite WASM fallback cannot run faithfully. It therefore executes under `test:postgres` and CI, which create and drop a disposable network PostgreSQL database under the restricted runtime role. Coverage includes: item creation restricted to the configurator role; a PR storing Unit, lines, quantity, justification and status, numbered from sequencing and replaying its command ID without duplicating; cross-Unit PR refusal; unknown-item refusal; RFQ refused on a draft PR, non-Vendor Party refusal, invitee widening and idempotent re-add; per-Vendor quotation terms and totals; revision keeping history and the wrong-vendor supersede refusal; quoting without an invitation refused; cross-tenant invisibility; and direct-SQL denial of item/quotation rewrites, PR fact edits, PR re-opening, forged quotations and header-less line inserts. `tests/http.test.ts` additionally asserts every procurement read returns 401 without a session and every mutation returns 403 without a trusted Origin.

The local development database has migrations up to `0013` applied, together with the demo `items` master data and the three monthly sequences. A live end-to-end probe against the dev server confirmed the full source flow — sign-in, seeded item list, item creation denied to a unit-scoped procurement user, PR creation in a granted Unit, command replay, cross-Unit refusal, RFQ refusal on a draft PR, submit, RFQ to two vendors, two quotations, a second revision with history preserved, the wrong-vendor supersede refusal, and an unauthenticated read returning 401 — before the throwaway probe script was removed.

Approval and the PO / Goods Receipt / Vendor Bill half remain open and are tracked in Linear, so there is nothing to exercise by hand for those yet; the whole PR → RFQ → quotation source flow is exercisable from the procurement panel.
