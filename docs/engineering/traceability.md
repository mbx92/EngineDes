# Engineering Traceability

## Required chain
Notion Requirement -> Linear Issue -> Branch -> PR -> Test -> Release.

## Naming
Branch examples:
- `feat/MBX-5-organization-foundation`
- `feat/MBX-10-vendor-comparison`
- `fix/MBX-8-payment-allocation`

PR title:
`[MBX-10][PROC-004] Vendor Comparison`

Commit messages should include the Linear issue when practical:
`feat(procurement): add quotation comparison [MBX-10]`

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
