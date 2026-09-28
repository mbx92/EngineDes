# MBX-8 — Phase 3 cash, billing AR/AP and payment allocation

Requirements: CASH-001, BILL-001..003, PAY-001..003, PARTY-003/004, ACC-002..005, LOCK-001, ORG-003, IAM-001/002, AUDIT-001, CFG-001, SEQ-001, MAP-001..004. Sources: Notion Functional Requirements v0.1, P0 Acceptance Criteria v0.1, Domain Model & Master Data, ADR-001/002/003/008/009, the Phase 3 section of the Delivery Agreement & Decision Register, and Linear MBX-8.

## Scope

This slice delivers money-flow foundations: tenant-owned cash/bank accounts, AR/AP documents with stored outstanding, aging, payments, payment allocation, and audited void. It is the first real consumer of the Phase 2 Business Event contract.

Delivered: migrations 0009–0010 (schema, forced RLS, least-privilege grants, append-only and money-flow guards), `server/core/billing/billing.ts`, and PostgreSQL acceptance coverage.

Not yet delivered, and not claimed: HTTP API routes, billing UI, refund commands, overpayment policy configuration, approval rules (deferred to MBX-11), and procurement-derived vendor bills (MBX-11). No business module composes billing commands yet.

## Accepted policies

The five policies absent from the product sources were decided by the PM and recorded canonically in the Notion decision register before implementation:

- **Overpayment (PAY-001):** rejected by default; permitted only when an explicit per-tenant overpayment policy is enabled. The policy is off by default, so this slice always rejects over-allocation.
- **Aging buckets (BILL-002):** not yet due, 1–30, 31–60, 61–90, >90 days overdue. Overdue is measured from the due date on the tenant calendar; the caller supplies the already-local `asOf` date.
- **Refund path (PAY-003):** a refund credits the same cash/bank account that received the original payment, resolved through Accounting Mapping. No clearing account is introduced.
- **Void semantics (PAY-003):** void is permitted only while the document has no allocations; afterwards correction must use refund or reversal.
- **Approval (IAM-003/WF-001):** deferred to MBX-11. This slice gates on explicit permission plus transactional audit only.

## Implemented contract

- **Cash/bank accounts (CASH-001)** are tenant-owned operational entities, each bound to exactly one existing ledger account in the same tenant. They are not a second ledger and hold no debit/credit rule. Configuration requires `financial.configure` (tenant Admin, as in Phase 2); Finance may read and use configured accounts but cannot create them, mirroring the Phase 2 boundary that Admin configures while Finance posts.
- **AR/AP documents (BILL-001..003, PARTY-004)** require Unit context and an identified Party that actually holds the required role for that Unit: `invoice` needs an active Customer, `bill` an active Vendor. Because anonymous documents are not a billing concept, the existing Phase 2 guard in `validateTransactionContext` is reused for the posted event rather than duplicated — `createsAR` with a null Party is already rejected, which is why no PARTY-004 defect existed to fix.
- **Outstanding is stored, not derived (BILL-001).** It only ever decreases, and it moves through exactly one path: payment allocation. A database guard rejects any direct `UPDATE` that tries to change outstanding outside the allocation path, so a caller that skips Core services cannot fabricate a settlement.
- **Allocation (PAY-001/002)** is append-only and bounded by the payment available amount and the document outstanding. Both the payment and the document are read `FOR UPDATE` inside the same transaction as the insert, and the balances are updated by the same statement, so concurrent callers cannot oversell the same balance. A partial payment leaves the document `open`; the document only becomes `paid` at zero outstanding. Payment and document must share Unit, Party, and compatible direction/type.
- **Void (PAY-003)** stores actor, reason and reference in an append-only `financial_document_events` trail plus transactional audit, and is refused once any allocation exists (enforced in the database, not only in the service).
- **Posting (MAP-001..004, ADR-001/003)** happens only through `postBusinessEvent`. The billing module supplies business facts and named whole-rupiah amounts; mapping alone resolves account IDs, sides and the Unit dimension. No account ID appears in the billing module, and no separate ledger is created.
- **Idempotency (SEQ-001, ACC-001)** reuses the established contract: document and payment creation return the existing row when the stored command ID is replayed, so a retry cannot allocate a second number or post a second journal. Numbering continues to come from `allocateNumber` with the caller's transaction.
- **Isolation (NFR-SEC-002)** is forced RLS on all five new tables with tenant-aware composite foreign keys, and runtime grants are append-only: `SELECT, INSERT` on the event trail and allocations, `SELECT, INSERT, UPDATE` only where a stored balance must move.

## Local verification and QA

Run `corepack pnpm test:postgres`, `corepack pnpm typecheck`, `corepack pnpm build` and `corepack pnpm test:artifact`.

The billing acceptance test is guarded by `TEST_DATABASE_URL` because its guarantees are database triggers, which the PGlite WASM fallback cannot run faithfully. It therefore executes under `test:postgres` and CI, which create and drop a disposable network PostgreSQL database under the restricted runtime role. Coverage includes: two-account configuration and role denial; AR/AP Party-role requirements; due-date and amount validation; sequence replay; aging bucket boundaries; partial payment keeping the document open; over-allocation denial against both bounds and closed documents; cross-tenant invisibility; void audit trail and allocated-document refusal; direct-SQL immutability and outstanding protection; and closed-period rejection.

The local development database has migrations 0009–0010 applied. `corepack pnpm test` (PGlite) reports two pre-existing failures in `trialBalance`, which is Phase 2 code in `server/core/accounting/engine.ts` and is untouched by this slice; the real PostgreSQL run passes all 54 tests, consistent with the Phase 2 note that PGlite cannot faithfully reproduce those semantics.

No billing UI is exposed yet, so there is nothing to exercise by hand in Akuntansi for this slice. Refund, overpayment policy and approval integration remain open and are tracked in Linear.
