# MBX-5 — Organization and scoped access foundation

Requirements: ORG-001/002, IAM-001/002, AUDIT-001, NFR-SEC-001..003, NFR-OBS-001/002, NFR-PERF-001, NFR-MNT-002.
Canonical decisions: [ADR-008](https://app.notion.com/p/3e83269cd65b8183a19cefe174336bfd), [ADR-009](https://app.notion.com/p/3e83269cd65b810092f9dbe51369fba6), [decision register](https://app.notion.com/p/3e83269cd65b81cd9b44fbac79f889b1).
Execution: [MBX-5](https://linear.app/mbx92/issue/MBX-5/phase-1-foundation-organization-iam-party-and-governance).

## Implemented slice

- Nuxt 4 on Node 22, native accessible HTML/Tailwind UI, email/password login and logout.
- Better Auth PostgreSQL sessions: 24-hour expiry, no sliding refresh or cookie data cache, minimum 12-character password, public signup disabled. Reviewed login/logout/session and the Core `/api/activate` flow are exposed. Reset/change-password endpoints remain withheld until their delivery/policy/audit paths are implemented.
- Six role names; each assignment pairs a role with tenant or Unit scope. Permissions are `unit.read`, `unit.create`, `account.read`, `account.create`, `account.manage`, `account.revoke`, `account.activation_link` and `organization.update`. All six roles can read Units within explicitly granted scope; only tenant-scoped Admin can create Units, administer users or update the tenant name. No financial posting or approval permissions are granted by these presets.
- Membership is reloaded per request; one identity belongs to one BUMDes, with multiple Unit/role assignments. Tenant/context comes from verified session and membership, never client-supplied roles.
- Unit read/create API, page size 50, stable ordering. Creation and audit append share a transaction. Duplicate Unit codes within a BUMDes return 409.
- Admin-only Users UI/API: paginated identities, multiple paired role/Unit grants, pending account creation, invitation resend, grant editing, account disable/enable and session revocation. The final active tenant-scoped admin cannot be removed/disabled. Tenant-serialized writes recheck current actor permission and audit atomically.
- Forced RLS for operational tables, tenant-aware composite foreign keys, actor-scoped membership discovery. The actor policy permits discovery of the authenticated user's membership before the tenant is known; after verification, transaction-local tenant context controls operational data. Identity/session tables are platform-scoped and inaccessible through general data APIs.
- App role has no ownership, superuser or BYPASSRLS privilege. Application startup rejects privileged/owner credentials. Audit rows are append-only for the app role.
- JSON logs carry server-generated request ID, available verified tenant/actor and build identity. They exclude headers/body/query and are separate from persisted audit.

## Dashboard UI

The dashboard has Ringkasan and Unit Usaha views, verified-session profile/roles, responsive navigation, scoped Unit status cards and a searchable/filterable Unit table. Search, status filtering and counts apply only to the currently loaded page (50 rows); they are not organization-wide totals. No financial/reporting values are fabricated. Unit creation uses the existing authorized/audited endpoint through a native modal dialog. Failed list refresh after a successful create reports the successful write rather than encouraging duplicate submission. The initial UI still uses native HTML, Vue and Tailwind, with local SVG icons; no component library or external assets were added.

Browser QA: login, navigation, unmatched search/reset, inactive filter/reset, modal open/cancel and mobile navigation. Unit creation remains covered by Core/API tests; UI inspection does not create sample business data.

## Environment and database setup

### Users, activation and settings

Pending accounts have `memberships.pending=true`, `active=false` and no password. The recipient creates a password through a random, hashed, 24-hour single-use activation token. Activation atomically creates the Better Auth credential, activates membership, consumes the token and appends audit. Email-delivered tokens mark email verified; manually delivered tokens do not prove email ownership. Pending accounts cannot be enabled through the status action. Disabling an active account deletes all sessions in the same audited transaction; re-enabling retains its existing password. Changing grants applies to subsequent requests.

**Direct link alternative (PM-selected option 2):** a tenant-scoped Admin may select **Tautan aktivasi** on a pending user, confirm issuance and copy the link for private delivery to that recipient. `POST /api/tenants/{tenantId}/users/{userId}/activation-link` uses explicit `account.activation_link` permission, current actor recheck, target tenant validation, same-Origin protection and `Cache-Control: no-store`. Issuance and `account.activation_link_issued` audit are atomic. New manual/email issuance invalidates all previous activation links for that identity. No schema migration is needed: a distinct verification identifier preserves delivery provenance.

Only this dedicated admin endpoint returns a bearer URL. Normal creation, resend and listing do not. The dialog holds the link in memory and clears it on close/unmount; it does not persist it in browser storage or audit/log payloads. Copying requires an explicit click, with a selectable field as fallback. Admin does not set or receive the password. This bypasses SMTP delivery only; activation, password policy, tenant isolation and individual accounts still apply. Manually activated identities retain unverified email status and can sign in under the existing email/password pilot policy.

Configure `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS or 465 TLS), `SMTP_FROM`, `SMTP_USER` and `SMTP_PASSWORD` in the environment. Nodemailer 10.0.11 uses required TLS, normal certificate validation and no message/protocol logs. The recipient link uses a URL fragment that the activation page removes from browser history; tokens are not in HTTP query strings. Credentials remain server-only. Actual sender/provider and email delivery are still unverified.

Creation commits the pending identity before attempting email delivery. The UI reports `sent`, failed or missing configuration accurately; use resend after fixing SMTP. Resend invalidates the prior token. No durable outbox, automatic retry, password reset or policy/MFA editor is included in this slice. A process interruption between commit and send may require admin resend. SMTP-dependent acceptance is not complete until real delivery is tested.

Basic Settings updates the tenant name using explicit permission and transactional audit. Existing session/password/activation policies are displayed read-only. Security/financial settings and custom permission definitions remain future work.

Migration `0002_quiet_red_shift.sql` adds pending status and scoped membership writes, role-grant insert/delete, and name-only tenant updates. Actor discovery remains SELECT-only; membership INSERT/UPDATE require current tenant context. Applied migrations must not be rewritten.

### Local hot reload

Stop the built server using port 3000, then run `corepack pnpm dev`. Nuxt binds to loopback on port 3000, loads local `.env`, uses Vite HMR for frontend/CSS and Nitro reload for server changes. Polling every 300 ms is enabled for the exFAT workspace. Environment/secrets changes require restarting the dev process. Production uses `.output/server/index.mjs` and does not run HMR/watchers.

Copy `.env.example` locally; never commit credentials. Provide `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `BETTER_AUTH_URL` and a cryptographically random `BETTER_AUTH_SECRET` of at least 32 characters. Set the exact browser origin; mutating Core endpoints reject missing/foreign Origin.

Use a disposable local PostgreSQL installation first. The migration/maintenance principal owns the schema and must be explicitly privileged for bootstrap; the application uses a separate restricted principal. If `enginedes_app` does not exist, the RLS migration needs CREATEROLE. A DBA can pre-create it as NOSUPERUSER/NOBYPASSRLS instead.

Run with migration credentials in the environment:

```sh
corepack pnpm db:migrate
```

The migration creates `enginedes_app` as NOLOGIN when absent. The operator must provision its login/password securely outside source control, then use that role for `DATABASE_URL`. Never give it table ownership, schema creation or BYPASSRLS. Restrict migration credentials to the release/maintenance job; do not put them into the application container.

Bootstrap is a restricted CLI for an empty installation. Supply `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` (12+ characters), `BOOTSTRAP_NAME` and `BOOTSTRAP_BUMDES` through a secure local environment, plus privileged `MIGRATION_DATABASE_URL`. Do not pass passwords as command arguments. The maintenance principal must have explicit superuser/BYPASSRLS privilege for this controlled bootstrap; this privilege is never used by HTTP requests.

```sh
corepack pnpm db:bootstrap
```

The CLI refuses an existing installation, hashes the initial password, and atomically records tenant, identity, membership, scoped admin grant and audit. Remove bootstrap credentials immediately afterward. Initial-client-admin identity and secure first-credential handoff remain operational tasks. Normal user account activation uses email or an explicitly issued direct admin link; this CLI is not public account provisioning.

`db:migrate` serializes runners using an advisory lock. No automatic migration runs during app startup. Schema snapshots are generated by Drizzle; custom migration `0001_tenant_isolation.sql` owns RLS policies/grants. Do not use `drizzle-kit push` against shared environments or replace applied migrations.

## Deployment

Coolify can build the explicit multi-stage Dockerfile. The runtime runs as non-root and copies only `.output`; supply secrets at runtime. `/api/health` is liveness, not database readiness. Run migrations separately before starting the compatible application. Production Node patch/base image review, PostgreSQL hosting, backup/restore and target server configuration remain outstanding.

The workspace drive is exFAT: pnpm uses `node-linker=hoisted` and copy imports. Nitro bundles JS dependencies to avoid symlink-dependent output. No third-party filesystem patch is retained. Re-evaluate bundling/asset inclusion if future dependencies introduce native modules or worker assets; verify the isolated artifact rather than relying on workspace `node_modules`.

## QA after local database setup

1. Bootstrap one admin; login with its email/password. Create two Units with distinct codes; both appear. Repeated code returns 409 and adds no Unit/audit row.
2. Use controlled fixtures to create an operator with Unit A scope, another role in Unit B, and a second BUMDes user. Verify Unit filtering and deny requests to a different BUMDes. A role in A must not grant permissions in B.
3. Operator Unit creation must return 403; no Unit or audit persists. Admin creation records matching actor, request ID and entity.
4. Update grants through a controlled maintenance fixture; the next request uses the changed access. No access is retained in session cache.
5. Revoke a user's sessions through `POST /api/tenants/{tenantId}/accounts/{userId}/revoke` using an authorized admin session and matching Origin. Previous session no longer authenticates. Cross-tenant target is denied and not affected.
6. With app-role SQL and no context, read no operational tenant rows. Wrong-tenant inserts and cross-tenant foreign keys fail. Reused connections must not retain transaction-local context.

Automated coverage lives in `tests/access.test.ts`, `tests/database.test.ts`, `tests/http.test.ts`, `tests/email.test.ts` and `tests/activation-link.test.ts`. Local tests default to PostgreSQL WASM/PGlite under the restricted role. Set `TEST_DATABASE_URL` to an empty disposable database whose name ends in `_test` and `TEST_RUNTIME_DATABASE_URL` to its restricted runtime connection to include real PostgreSQL concurrency coverage. The Users/Settings/direct-link slice passed 35 tests against an isolated network PostgreSQL database, including concurrent last-admin protection, manual/email token invalidation, denied non-admin/cross-tenant issuance, audit rollback, expiry/replay and successful manually activated login without false email verification; the temporary database was removed. Typecheck, production build and isolated artifact smoke also passed. CI is configured for PostgreSQL 18 but remote CI has not been run. These checks do not prove production infrastructure, real SMTP delivery, Docker image behavior or all MBX-5 acceptance criteria.

## Remaining MBX-5 work

Real SMTP activation delivery and password recovery/change lifecycle; configurable password policy/MFA; custom permission definitions; Location assignments; Party and Customer Policy; broader configuration governance; concurrent numbering; approval-policy separation of duties. ORG-003 and IAM-003 integration require subsequent transaction/approval flows. MBX-5 remains In Progress.
