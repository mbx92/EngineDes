# Engineering Traceability

## Required chain
Notion Requirement -> Linear Issue -> Branch -> PR -> Test -> Release.

## Naming
Branch examples:
- `feat/MBX-5-organization-foundation`
- `feat/MBX-9-procurement-source-flow`
- `feat/MBX-10-vendor-comparison`
- `fix/MBX-8-payment-allocation`

PR title:
`[MBX-10][PROC-004] Vendor Comparison`

Use Conventional Commits with the Linear issue and affected requirement IDs:
`feat(procurement): add quotation comparison [MBX-10][PROC-004]`

## Delivered slices

| Linear | Requirements | Core | Migration | Acceptance |
| --- | --- | --- | --- | --- |
| MBX-5 | ORG, PARTY, IAM-001/002 | `server/core/organization`, `server/core/iam`, `server/core/governance` | 0001–0008 | `tests/database.test.ts`, `tests/access.test.ts` |
| MBX-6/7 | ACC, MAP, LOCK, CFG, SEQ | `server/core/accounting`, `server/core/governance` | 0004–0008 | `tests/database.test.ts` (accounting) |
| MBX-8 | CASH-001, BILL-001..003, PAY-001..003 | `server/core/billing` | 0009–0012 | `tests/database.test.ts` (billing) |
| MBX-9 | PROC-001..004 | `server/core/procurement` | 0013 | `tests/database.test.ts` (procurement) |

Each slice's design decision, accepted policy and verification evidence is recorded in its `docs/engineering/MBX-*.md` page.

## Pull request evidence
Every implementation PR should state:
- Linear issue
- Requirement IDs
- What changed
- Acceptance criteria covered
- Tests run
- Architecture/ADR impact
- Documentation impact

## Documentation synchronization
Update Linear for implementation progress.
Update Notion only when product requirements, architecture, domain behavior, acceptance criteria, or ADRs change.
Do not mirror every commit into Notion.
