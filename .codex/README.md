# Codex Project Guidance

Codex should read the repository root `AGENTS.md` before implementation.

## External context
Codex is expected to have MCP access to:
- Linear — execution context and issue updates.
- Notion — PRD, ADR, acceptance criteria, domain/business documentation.

GitHub is the implementation source of truth.

## Before coding
Given `MBX-xxx`:
1. Fetch the Linear issue.
2. Resolve requirement IDs.
3. Fetch relevant Notion pages.
4. Inspect repository.
5. State implementation plan.
6. Implement and test.

## After coding
1. Summarize changes.
2. Report tests/validation.
3. Update Linear.
4. Update Notion only for meaningful product/architecture/domain documentation changes.
5. Prepare a traceable PR.

Do not store access tokens or MCP credentials in this repository. User-level Codex/MCP authentication belongs outside version control.
