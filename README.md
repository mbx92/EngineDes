# EngineDes

EngineDes is the implementation repository for the BUMDes Platform.

## Project systems
- **Notion** — product knowledge, PRD, ADR, business flows, acceptance criteria.
- **Linear** — engineering execution under project **BUMDes Platform — Core MVP**.
- **GitHub** — implementation, tests, pull requests, and code history.
- **Codex** — engineering agent; follow `AGENTS.md` before making changes.

## Current phase
Core Platform MVP. MBX-5 is in progress: Nuxt dashboard, email/password sessions, scoped Units, tenant-admin user management, single-use email activation, basic BUMDes profile settings and transactional audit. SMTP delivery requires operator configuration. Party, numbering, recovery delivery, configurable security settings and remaining governance are subsequent slices.

## Repository policy
The accepted stack is TypeScript, Nuxt 4/Vue 3/Nitro, Tailwind 4, PostgreSQL/Drizzle, Better Auth, Zod, Pino and pnpm on Node 22. See [ADR-008](https://app.notion.com/p/3e83269cd65b8183a19cefe174336bfd), [ADR-009](https://app.notion.com/p/3e83269cd65b810092f9dbe51369fba6) and the [decision register](https://app.notion.com/p/3e83269cd65b81cd9b44fbac79f889b1). These remain canonical; local docs describe their implementation.

## Development

Use Node 22.19.0 and Corepack/pnpm 10.32.1. Dependency versions and the lockfile are pinned. The package version is an initial development version, not a released artifact.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

The login page and `/api/health` run without database credentials. Login and operational data require a configured PostgreSQL database, migrations, restricted runtime role and initial admin. See [foundation setup and QA](docs/engineering/MBX-5-foundation.md). No default user/password or demo authentication bypass is included.

`pnpm dev` uses http://localhost:3000 with loopback binding, Vite HMR for frontend edits and Nitro reload for server edits. Polling is enabled for the exFAT workspace. Nuxt loads `.env` in development; restart the dev process after changing environment/secrets. Stop any built runtime using port 3000 first. Production still uses the built Nitro artifact, without a development watcher.

Tests default to PGlite under restricted `enginedes_app`. `TEST_DATABASE_URL` selects a disposable PostgreSQL database ending in `_test`; optional `TEST_RUNTIME_DATABASE_URL` enables network concurrency tests on that same database. Live PostgreSQL SQL/RLS/auth/concurrency tests have passed in an isolated database. Production infrastructure, Docker and real SMTP delivery remain separate validation tasks.

## Traceability
```
Notion Requirement
  -> Linear Issue
  -> Git Branch
  -> Commit / Pull Request
  -> Tests
  -> Release
```

See `docs/engineering/traceability.md` and `AGENTS.md`.
