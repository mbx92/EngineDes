# MBX-8 — Phase 3 cash, billing AR/AP and payment allocation

Requirements: CASH-001, BILL-001..003, PAY-001..003, PARTY-003/004, ACC-002..005, LOCK-001, ORG-003, IAM-001/002, AUDIT-001, CFG-001, SEQ-001, MAP-001..004. Sources: Notion Functional Requirements v0.1, P0 Acceptance Criteria v0.1, Domain Model & Master Data, ADR-001/002/003/008/009, the Phase 3 section of the Delivery Agreement & Decision Register, and Linear MBX-8.

## Scope

This slice delivers money-flow foundations: tenant-owned cash/bank accounts, AR/AP documents with stored outstanding, aging, payments, payment allocation, and audited void. It is the first real consumer of the Phase 2 Business Event contract.

Delivered: migrations 0009–0012 (schema, forced RLS, least-privilege grants, append-only and money-flow guards), `server/core/billing/billing.ts`, HTTP API routes under `server/api/tenants/[tenantId]/billing/`, the `BillingPanel.vue` surface wired into the shell, and PostgreSQL acceptance coverage.

Not yet delivered, and not claimed: overpayment policy configuration, approval rules (deferred to MBX-11), and procurement-derived vendor bills (MBX-11). No other business module composes billing commands yet.

Follow-up delivered after the Phase 3 merge (MBX-8 remained open for void/refund): **payment void** now exists at parity with document void. `voidPayment` in `server/core/billing/billing.ts` refuses an allocated payment, records actor/reason/reference on the payment row, writes a `payment.voided` audit entry, and reverses the payment's original cash journal inside the same transaction (ACC-003, NFR-DATA-002). The rule is enforced twice: in Core and by the `payment_guard` trigger replaced in migration `0011`, so a direct SQL void without an actor or over an allocated payment is rejected. The `BillingPanel` payments tab exposes the command with a reversal-date field that defaults to the payment book date. **Payment refund** then closed the other half of PAY-003; see “Refund” below.

## Refund (PAY-003)

A refund returns cash to the same cash/bank account that received the original payment and restores the document outstanding by the refunded amount, because BILL-001 defines outstanding as the document amount minus valid allocated payment/refund effects. The contract was decided by the PM and recorded canonically in the Notion decision register before implementation.

- **Bounded by the collection, not the payment (PAY-003).** A refund may not exceed what that payment actually allocated to that document, and repeated refunds are summed against the same allocation. `payment_allocations` therefore stays the immutable record of what was collected; refunds live in the new append-only `payment_refunds` table (migration `0012`), so a correction is added rather than rewriting collected history.
- **Accounting effect comes from mapping (MAP-001..004, ADR-001/003).** The refund posts a `sales_refund` (cash in) or `purchase_refund` (cash out) Business Event through `postBusinessEvent`, mirroring the payment it corrects. Mapping resolves the accounts, so refunds stay configurable and no ledger account ID or debit/credit rule enters the billing module. No clearing account is introduced.
- **Two flags, two directions.** Outstanding only ever moved down through allocation, so the Phase 3 `financial_document_guard` rejected any increase. Migration `0012` replaces it so allocation (`app.billing_allocation`) may only decrease outstanding while a refund (`app.billing_refund`) may only restore it, bounded by the document amount; every other path, including direct SQL, is still refused.
- **Traceability (AUDIT-001, NFR-DATA-002).** The refund row stores actor, reason, reference and the originating command ID; the document trail gains a `refunded` entry and the payment gains a `payment.refunded` audit entry that records the allocation, the cumulative refunded amount and the restored outstanding.
- **Idempotency (SEQ-001).** A replayed `eventId` returns the stored refund instead of refunding twice, using the same command-ID contract document and payment creation follow.


## Accepted policies

The five policies absent from the product sources were decided by the PM and recorded canonically in the Notion decision register before implementation:

- **Overpayment (PAY-001):** rejected by default; permitted only when an explicit per-tenant overpayment policy is enabled. The policy is off by default, so this slice always rejects over-allocation.
- **Aging buckets (BILL-002):** not yet due, 1–30, 31–60, 61–90, >90 days overdue. Overdue is measured from the due date on the tenant calendar; the caller supplies the already-local `asOf` date.
- **Refund path (PAY-003):** a refund credits the same cash/bank account that received the original payment, resolved through Accounting Mapping. No clearing account is introduced. It restores the document outstanding and is bounded by the amount that payment allocated to that document.
- **Void semantics (PAY-003):** void is permitted only while the document has no allocations; afterwards correction must use refund or reversal.
- **Approval (IAM-003/WF-001):** deferred to MBX-11. This slice gates on explicit permission plus transactional audit only.

## Implemented contract

- **Cash/bank accounts (CASH-001)** are tenant-owned operational entities, each bound to exactly one existing ledger account in the same tenant. They are not a second ledger and hold no debit/credit rule. Configuration requires `financial.configure` (tenant Admin, as in Phase 2); Finance may read and use configured accounts but cannot create them, mirroring the Phase 2 boundary that Admin configures while Finance posts.
- **AR/AP documents (BILL-001..003, PARTY-004)** require Unit context and an identified Party that actually holds the required role for that Unit: `invoice` needs an active Customer, `bill` an active Vendor. Because anonymous documents are not a billing concept, the existing Phase 2 guard in `validateTransactionContext` is reused for the posted event rather than duplicated — `createsAR` with a null Party is already rejected, which is why no PARTY-004 defect existed to fix.
- **Outstanding is stored, not derived (BILL-001).** It only ever decreases through payment allocation and is only restored by a refund. A database guard rejects any direct `UPDATE` that tries to move outstanding outside those two flagged paths, so a caller that skips Core services cannot fabricate a settlement or a refund.
- **Allocation (PAY-001/002)** is append-only and bounded by the payment available amount and the document outstanding. Both the payment and the document are read `FOR UPDATE` inside the same transaction as the insert, and the balances are updated by the same statement, so concurrent callers cannot oversell the same balance. A partial payment leaves the document `open`; the document only becomes `paid` at zero outstanding. Payment and document must share Unit, Party, and compatible direction/type.
- **Void (PAY-003)** stores actor, reason and reference in an append-only `financial_document_events` trail plus transactional audit, and is refused once any allocation exists (enforced in the database, not only in the service).
- **Payment void (PAY-003)** mirrors document void: a `posted` payment may be cancelled while it carries no allocation, which fills in the payment `voided_at`/`voided_by` evidence, appends a `payment.voided` audit entry, and posts a reversal journal that references the payment's original cash journal. An allocated payment is refused in Core and by the `payment_guard` trigger, preserving the allocated history that a void would otherwise hide. The reversal date defaults to the payment book date so original and reversal share one accounting period and the closed-period rule keeps applying.
- **Posting (MAP-001..004, ADR-001/003)** happens only through `postBusinessEvent`. The billing module supplies business facts and named whole-rupiah amounts; mapping alone resolves account IDs, sides and the Unit dimension. No account ID appears in the billing module, and no separate ledger is created.
- **Idempotency (SEQ-001, ACC-001)** reuses the established contract: document and payment creation return the existing row when the stored command ID is replayed, so a retry cannot allocate a second number or post a second journal. Numbering continues to come from `allocateNumber` with the caller's transaction.
- **Isolation (NFR-SEC-002)** is forced RLS on all five new tables with tenant-aware composite foreign keys, and runtime grants are append-only: `SELECT, INSERT` on the event trail and allocations, `SELECT, INSERT, UPDATE` only where a stored balance must move.

## HTTP boundary and UI

- **Routes** mirror the Phase 2 accounting pattern under `server/api/tenants/[tenantId]/billing/`: `GET/POST cash-accounts`, `GET/POST documents`, `POST documents/void`, `GET aging`, `GET/POST payments`, `POST payments/void`, `POST payments/refund`, `GET refunds`, `GET/POST allocations`. Reads are `no-store` and permission-checked in Core; mutations enforce same-origin then resolve the actor through `authenticated`. Tenant scope comes only from the path plus the session, never from the body.
- **Capabilities** in `access.get.ts` add `canReadBilling`, `canManageCashAccounts` and `canPostBilling`. Read and post follow the Phase 2 boundary — tenant Admin configures cash accounts, Finance posts inside its assigned Unit scope — and the UI hides the cash-account tab from non-configurators.
- **`BillingPanel.vue`** exposes four tabs: cash/bank accounts (with ledger-account picker), documents (invoice/bill registration, outstanding list, audited void), receivables/payables aging with bucket cards, and payments (recording, allocation from a selected payment to a matching open document, audited cancellation of an unallocated payment with a reversal date, and a refund form bound to the collected payment/document pairs). It reuses the existing `AccountingPanel` layout, tab semantics and error handling, and revalidates against the server on every mutation. A refused command surfaces the authored 409 message instead of a generic failure.

## Local verification and QA

Run `corepack pnpm test:postgres`, `corepack pnpm typecheck`, `corepack pnpm build` and `corepack pnpm test:artifact`.

The billing acceptance test is guarded by `TEST_DATABASE_URL` because its guarantees are database triggers, which the PGlite WASM fallback cannot run faithfully. It therefore executes under `test:postgres` and CI, which create and drop a disposable network PostgreSQL database under the restricted runtime role. Coverage includes: two-account configuration and role denial; AR/AP Party-role requirements; due-date and amount validation; sequence replay; aging bucket boundaries; partial payment keeping the document open; over-allocation denial against both bounds and closed documents; cross-tenant invisibility; void audit trail and allocated-document refusal; payment void evidence, journal reversal, re-void and allocated-payment refusal plus direct-SQL denial; refund restoring outstanding through the mapped `sales_refund` event with the exact mirrored journal lines, the allocation bound, the missing-allocation refusal, replayed-command idempotency, cross-tenant invisibility, direct-insert bound denial and append-only history; direct-SQL immutability, both outstanding directions and closed-period rejection. `tests/http.test.ts` additionally asserts every billing read returns 401 without a session and every mutation returns 403 without a trusted Origin.

The local development database has migrations 0009–0012 applied. `corepack pnpm test` (PGlite) reports two pre-existing failures in `trialBalance`, which is Phase 2 code in `server/core/accounting/engine.ts` and is untouched by this slice; the real PostgreSQL run passes all 57 tests, consistent with the Phase 2 note that PGlite cannot faithfully reproduce those semantics.

## Post-merge correction

The Phase 3 pull request merged before two boundary corrections were committed, so `main` briefly carried the defect. This commit lands them: billing reads and mutations again return whole-rupiah amounts as exact strings (a raw `bigint` row cannot cross the JSON boundary, so `GET /billing/documents` answered 500 with `Do not know how to serialize a BigInt`), and a PostgreSQL `P0001` guard refusal now maps to HTTP 409 with its authored message instead of surfacing as a 500. The dummy seed also gained the billing chart, the four event mappings and the three monthly sequences, without which a fresh install could not post an invoice, bill or payment.

No overpayment policy or approval flow is exposed yet, so there is nothing to exercise by hand for those; they remain open and are tracked in Linear. Payment void and payment refund are both exercisable by hand from the payments tab.
