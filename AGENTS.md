# EngineDes Agent Rules

EngineDes is the implementation repository for the BUMDes Platform.

## Sources of truth
- Notion: product requirements, ADRs, domain model, business flows, acceptance criteria, NFRs.
- Linear: execution status, dependencies, blockers, implementation progress.
- GitHub: source code, migrations, tests, pull requests, implementation history.

## Required traceability
Notion Requirement -> Linear Issue -> Branch -> Commit/PR -> Tests -> Release.

Every engineering change must preserve its requirement ID and Linear issue.
Use Conventional Commits (`feat`, `fix`, `chore`, `docs`, `test`, or `refactor`) with the relevant Linear issue and requirement IDs in the commit message.
Example:
- Requirement: PROC-004
- Linear: MBX-10
- Branch: feat/MBX-10-vendor-comparison
- PR: [MBX-10][PROC-004] Vendor Comparison

## Architecture invariants
1. Accounting Engine is centralized.
2. Unit Usaha is an organizational/accounting dimension, not a separate ledger.
3. Business modules must not create their own ledger.
4. Business modules must not hard-code account IDs or debit/credit rules.
5. Financial business events pass through Accounting Mapping.
6. Posted journals are corrected through reversal/adjustment.
7. Closed accounting periods cannot be silently edited.
8. Financial posting must be atomic.
9. Tenant-owned data must preserve tenant isolation.
10. Sensitive changes require audit trail.
11. Party is the shared identity foundation; Customer/Vendor are roles/context.
12. Anonymous transactions are allowed only when Customer Policy allows them; AR requires an identified Party.

## Working on MBX-xxx
1. Read the Linear issue.
2. Extract referenced requirement IDs.
3. Read relevant Notion PRD, ADRs, and acceptance criteria.
4. Inspect existing code and tests.
5. Write a short implementation plan before coding.
6. Implement the smallest complete vertical change.
7. Add/update tests for acceptance criteria.
8. Run relevant validation.
9. Update Linear with summary, affected requirements, test results, PR/commit, and blockers/deviations.
10. Update Notion only if requirement, architecture, domain behavior, or an ADR changed.

Do not silently invent a product or architecture rule. If implementation exposes an undocumented decision, record the decision before treating it as a new invariant.

## Definition of Done
- Acceptance criteria pass.
- Authorization and tenant scope are tested where applicable.
- Audit behavior is tested where applicable.
- Requirement IDs are referenced by implementation/tests.
- No known ADR violation remains.
- Linear is updated.
- Documentation is updated when contracts, schemas, requirements, or architecture changed.
