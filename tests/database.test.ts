import { randomUUID } from 'node:crypto'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { eq, sql } from 'drizzle-orm'
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite'
import { drizzle as postgresDrizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { PGlite } from '@electric-sql/pglite'
import { hashPassword } from 'better-auth/crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../server/database/client'
import * as schema from '../server/database/schema'
import { withActor } from '../server/core/iam/context'
import { createUnit, listUnits } from '../server/core/organization/units'
import { revokeLogin } from '../server/core/iam/revoke'
import { createAuth } from '../server/auth/options'
import { createUser, listUsers, resendInvitation, updateGrants, setAccountActive, issueManualActivation } from '../server/core/iam/users'
import { activateAccount } from '../server/core/iam/activation'
import { updateOrganization } from '../server/core/organization/settings'

import { createLocation, listLocations } from '../server/core/organization/locations'
import { saveParty, listParties } from '../server/core/party/parties'
import { setConfiguration, listConfigurations } from '../server/core/governance/configuration'
import { validateTransactionContext, requireApproval } from '../server/core/governance/transaction-context'
import { allocateNumber } from '../server/core/governance/numbering'
import { seedDummy } from '../server/core/governance/demo'
import { createLedgerAccount, setAccountingMapping, postBusinessEvent, closeAccountingPeriod, reverseJournal, adjustJournal, trialBalance, ledger } from '../server/core/accounting/engine'
import { allocatePayment, createCashAccount, createFinancialDocument, createPayment, listAllocations, listCashAccounts, listFinancialDocuments, listPayments, listRefunds, receivablesAging, refundPayment, voidFinancialDocument, voidPayment } from '../server/core/billing/billing'
import { createItem, listItems, createPurchaseRequest, submitPurchaseRequest, listPurchaseRequests, createRfq, addRfqVendors, listRfqs, createQuotation, listQuotations } from '../server/core/procurement/procurement'
import { compareQuotations } from '../server/core/procurement/comparison'
import { readConfiguration } from '../server/core/governance/configuration'

const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002'
const A1 = '00000000-0000-4000-8000-000000000011', A2 = '00000000-0000-4000-8000-000000000012', B1 = '00000000-0000-4000-8000-000000000021'
const MA = '00000000-0000-4000-8000-000000000101', MO = '00000000-0000-4000-8000-000000000102', MB = '00000000-0000-4000-8000-000000000201'
interface SQLHarness {
  query<T = Record<string, unknown>>(query: string, parameters?: unknown[]): Promise<{ rows: T[] }>
  exec(query: string): Promise<unknown>
  close(): Promise<void>
}
let pg: SQLHarness, db: Database, auth: ReturnType<typeof createAuth>
const password = 'Local-test-passphrase-123!'
// [MBX-8] Billing fixture identifiers, seeded in beforeAll under the privileged role.
const BT='00000000-0000-4000-8000-000000000701', BU1='00000000-0000-4000-8000-000000000711', BU2='00000000-0000-4000-8000-000000000712'
const BM='00000000-0000-4000-8000-000000000721', BMU='00000000-0000-4000-8000-000000000722'
// [MBX-9] Procurement fixture identifiers, seeded in beforeAll under the privileged role.
const PT='00000000-0000-4000-8000-000000000801', PU1='00000000-0000-4000-8000-000000000811', PU2='00000000-0000-4000-8000-000000000812'
const PM='00000000-0000-4000-8000-000000000821', PMU='00000000-0000-4000-8000-000000000822'
const rowsOf = (result: unknown): unknown[] => Array.isArray(result) ? result : (result as { rows: unknown[] }).rows
// Database triggers are surfaced through drizzle's wrapped error, so assert on the cause.
const dbRejection = async (run: () => Promise<unknown>, text: string) => {
  try { await run() } catch (error) { expect(String((error as {cause?:Error}).cause || error)).toContain(text); return }
  throw new Error('Expected database rejection containing: ' + text)
}
describe('[MBX-5] PostgreSQL semantics, scoped access and authentication', () => {
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL
    if (url) {
      if (!new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a disposable database ending in _test')
      const connection = postgres(url, { max: 1 })
      pg = {
        query: async <T>(query: string, parameters: unknown[] = []) => ({ rows: Array.from(await connection.unsafe(query, parameters as never[])) as T[] }),
        exec: query => connection.unsafe(query).simple(), close: () => connection.end(),
      }
      db = postgresDrizzle(connection, { schema })
    } else {
      const memory = new PGlite()
      pg = memory
      db = pgliteDrizzle(memory, { schema }) as unknown as Database
    }
    for (const migration of readMigrationFiles({ migrationsFolder: './migrations' })) {
      for (const statement of migration.sql) await pg.exec(statement)
    }
    // Both backends run as the restricted role; local WASM alone is not a production connection test.
    const hash = await hashPassword(password)
    await pg.query(`INSERT INTO auth_user(id,name,email) VALUES ('admin-a','Admin A','admin-a@example.test'), ('operator-a','Operator A','operator-a@example.test'), ('user-b','User B','user-b@example.test')`)
    await pg.query(`INSERT INTO auth_account(id,account_id,provider_id,user_id,password) VALUES ('credential-a','admin-a','credential','admin-a',$1)`, [hash])
    await pg.query(`INSERT INTO tenants(id,name) VALUES ($1,'BUMDes A'),($2,'BUMDes B')`, [A, B])
    await pg.query(`INSERT INTO units(id,tenant_id,name,code) VALUES ($1,$4,'Toko A','A1'),($2,$4,'Jasa A','A2'),($3,$5,'Toko B','B1')`, [A1,A2,B1,A,B])
    await pg.query(`INSERT INTO memberships(id,tenant_id,user_id) VALUES ($1,$4,'admin-a'),($2,$4,'operator-a'),($3,$5,'user-b')`, [MA,MO,MB,A,B])
    await pg.query(`INSERT INTO role_grants(tenant_id,membership_id,role,scope,unit_id) VALUES ($1,$3,'admin','tenant',NULL),($1,$4,'unit_manager','unit',$5),($1,$4,'operator','unit',$6),($2,$7,'operator','tenant',NULL)`, [A,B,MA,MO,A1,A2,MB])
    await pg.query(`INSERT INTO auth_user(id,name,email) VALUES ('finance-a','Finance A','finance-a@example.test')`)
    await pg.query(`INSERT INTO memberships(id,tenant_id,user_id) VALUES ('00000000-0000-4000-8000-000000000103',$1,'finance-a')`,[A])
    await pg.query(`INSERT INTO role_grants(tenant_id,membership_id,role,scope) VALUES ($1,'00000000-0000-4000-8000-000000000103','finance','tenant')`,[A])
    await pg.query(`INSERT INTO auth_user(id,name,email) VALUES ('finance-unit-a','Finance Unit A','finance-unit-a@example.test')`)
    await pg.query(`INSERT INTO memberships(id,tenant_id,user_id) VALUES ('00000000-0000-4000-8000-000000000104',$1,'finance-unit-a')`,[A])
    await pg.query(`INSERT INTO role_grants(tenant_id,membership_id,role,scope,unit_id) VALUES ($1,'00000000-0000-4000-8000-000000000104','finance','unit',$2)`,[A,A1])
    auth = createAuth(db, 'test-only-secret-not-a-production-secret-123456', 'http://localhost:3000')
    // [MBX-8] Billing tenant seeded as the privileged role; configuration stays inside withActor.
    await pg.query(`INSERT INTO tenants(id,name) VALUES ($1,'BUMDes Billing')`, [BT])
    await pg.query(`INSERT INTO units(id,tenant_id,name,code) VALUES ($1,$3,'Toko Billing','BIL-1'),($2,$3,'Jasa Billing','BIL-2')`, [BU1, BU2, BT])
    await pg.query(`INSERT INTO auth_user(id,name,email) VALUES ('billing-admin','Billing Admin','billing-admin@example.test'),('billing-unit','Billing Unit','billing-unit@example.test')`)
    await pg.query(`INSERT INTO memberships(id,tenant_id,user_id) VALUES ($1,$3,'billing-admin'),($2,$3,'billing-unit')`, [BM, BMU, BT])
    await pg.query(`INSERT INTO role_grants(tenant_id,membership_id,role,scope,unit_id) VALUES ($1,$2,'admin','tenant',NULL),($1,$3,'finance','unit',$4),($1,$2,'finance','tenant',NULL)`, [BT, BM, BMU, BU1])
    // [MBX-9] Procurement tenant: one tenant-scoped administrator who owns master data and
    // sequencing, and one Unit-scoped `procurement` grant that must stay inside its assigned Unit.
    await pg.query(`INSERT INTO tenants(id,name) VALUES ($1,'BUMDes Procurement')`, [PT])
    await pg.query(`INSERT INTO units(id,tenant_id,name,code) VALUES ($1,$3,'Toko Procurement','PROC-1'),($2,$3,'Jasa Procurement','PROC-2')`, [PU1, PU2, PT])
    await pg.query(`INSERT INTO auth_user(id,name,email) VALUES ('procurement-admin','Procurement Admin','procurement-admin@example.test'),('procurement-unit','Procurement Unit','procurement-unit@example.test')`)
    await pg.query(`INSERT INTO memberships(id,tenant_id,user_id) VALUES ($1,$3,'procurement-admin'),($2,$3,'procurement-unit')`, [PM, PMU, PT])
    await pg.query(`INSERT INTO role_grants(tenant_id,membership_id,role,scope,unit_id) VALUES ($1,$2,'admin','tenant',NULL),($1,$3,'procurement','unit',$4)`, [PT, PM, PMU, PU1])
  })
  beforeEach(async () => { await pg.exec('SET ROLE enginedes_app') })
  afterEach(async () => { await pg.exec('RESET ROLE') })
  afterAll(async () => { await pg.close() })

  it('[NFR-SEC-002] runtime role has no owner/superuser/RLS bypass and absent context denies reads', async () => {
    const role = await pg.query<{ rolsuper: boolean; rolbypassrls: boolean }>(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false })
    expect((await pg.query('SELECT * FROM units')).rows).toEqual([])
    expect((await pg.query('SELECT * FROM memberships')).rows).toEqual([])
  })
  it('[ORG-002][IAM-002] operator sees multiple assigned Units, no other tenant', async () => {
    const rows = await withActor(db, 'operator-a', A, listUnits)
    expect(rows.map(row => row.id).sort()).toEqual([A1, A2])
    await expect(withActor(db, 'operator-a', B, listUnits)).rejects.toThrow('Tenant access denied')
    expect((await pg.query('SELECT * FROM units')).rows).toEqual([])
  })
  it('[NFR-SEC-002] raw SQL/joins/write cannot cross tenant and transaction context is cleared', async () => {
    await withActor(db, 'admin-a', A, async tx => {
      const rows = await tx.execute(sql`SELECT u.id FROM units u JOIN tenants t ON t.id=u.tenant_id WHERE u.tenant_id=${B}`)
      expect(rowsOf(rows)).toEqual([])
    })
    await expect(withActor(db, 'admin-a', A, tx => tx.execute(sql`INSERT INTO units(tenant_id,name,code) VALUES (${B},'Illegal','DENIED')`))).rejects.toThrow()
    expect((await pg.query('SELECT * FROM units')).rows).toEqual([])
    const other = await withActor(db, 'user-b', B, listUnits)
    expect(other.map(row => row.id)).toEqual([B1])
  })
  it('[ORG-001][AUDIT-001] authorized Unit creation persists one matching audit in the same transaction', async () => {
    const id = randomUUID()
    const unit = await withActor(db, 'admin-a', A, (tx, actor) => createUnit(tx, actor, { name: 'Pertanian', code: 'NEW-A' }, id))
    await withActor(db, 'admin-a', A, async tx => {
      const result = await tx.execute(sql`SELECT actor_id,request_id,action FROM audit_events WHERE entity_id=${unit.id}`)
      expect(rowsOf(result)).toEqual([{ actor_id: 'admin-a', request_id: id, action: 'unit.created' }])
    })
  })
  it('[IAM-001/002] Unit-scoped operator cannot create a Unit or revoke tenant accounts', async () => {
    await expect(withActor(db, 'operator-a', A, (tx, actor) => createUnit(tx, actor, { name: 'Denied', code: 'DENIED-A' }, randomUUID()))).rejects.toThrow('Permission or scope denied')
    await expect(withActor(db, 'operator-a', A, (tx, actor) => revokeLogin(tx, actor, 'admin-a', randomUUID()))).rejects.toThrow()
    await expect(withActor(db, 'admin-a', A, (tx, actor) => revokeLogin(tx, actor, 'user-b', randomUUID()))).rejects.toThrow()
  })
  it('[AUDIT-001] audit failure rolls back the Unit and app cannot mutate existing audit', async () => {
    // Invalid request UUID is rejected by PostgreSQL at audit insert, after the Unit insert.
    await expect(withActor(db, 'admin-a', A, (tx, actor) => createUnit(tx, actor, { name: 'Rollback', code: 'ROLLBACK' }, 'invalid'))).rejects.toThrow()
    await withActor(db, 'admin-a', A, async tx => {
      expect(rowsOf(await tx.execute(sql`SELECT id FROM units WHERE code='ROLLBACK'`))).toEqual([])
    })
    await expect(pg.exec('DELETE FROM audit_events')).rejects.toThrow()
  })
  it('[ORG-002][NFR-SEC-002] tenant-aware references reject a grant pointing to another BUMDes Unit', async () => {
    // Maintenance role bypasses RLS to specifically test FK protection, independent of policies.
    await pg.exec('RESET ROLE')
    await expect(pg.query(`INSERT INTO role_grants(tenant_id,membership_id,role,scope,unit_id) VALUES ($1,$2,'operator','unit',$3)`, [A,MO,B1])).rejects.toThrow()
  })
  it('[IAM-001/002] permissions are reloaded after grant changes', async () => {
    await pg.exec('RESET ROLE')
    await pg.query(`UPDATE role_grants SET role='supervisor' WHERE membership_id=$1`, [MA])
    await pg.exec('SET ROLE enginedes_app')
    try {
      await expect(withActor(db, 'admin-a', A, (tx, actor) => createUnit(tx, actor, { name: 'Denied', code: 'CHANGED' }, randomUUID()))).rejects.toThrow()
    } finally {
      await pg.exec('RESET ROLE')
      await pg.query(`UPDATE role_grants SET role='admin' WHERE membership_id=$1`, [MA])
    }
  })
  it('[IAM-001/002] disabled membership denies access despite a valid identity', async () => {
    await pg.exec('RESET ROLE')
    await pg.query(`UPDATE memberships SET active=false WHERE id=$1`, [MO])
    await pg.exec('SET ROLE enginedes_app')
    try { await expect(withActor(db, 'operator-a', A, listUnits)).rejects.toThrow('Tenant access denied') }
    finally {
      await pg.exec('RESET ROLE')
      await pg.query(`UPDATE memberships SET active=true WHERE id=$1`, [MO])
    }
  })
  it('[IAM-001] public signup is denied, wrong password rejected, persisted session expires in 24h and revoke takes effect', async () => {
    const request = (path: string, body?: object, cookie?: string) => new Request(`http://localhost:3000/api/auth/${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    expect((await auth.handler(request('sign-up/email', { name: 'Untrusted', email: 'new@example.test', password }))).ok).toBe(false)
    expect((await auth.handler(request('sign-in/email', { email: 'admin-a@example.test', password: 'Wrong password' }))).ok).toBe(false)
    const login = await auth.handler(request('sign-in/email', { email: 'admin-a@example.test', password, rememberMe: false }))
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    const current = await pg.query<{ token: string; seconds: number }>(`SELECT token,extract(epoch FROM (expires_at-created_at))::float AS seconds FROM auth_session WHERE user_id='admin-a'`)
    expect(current.rows[0]!.seconds).toBeCloseTo(86400, 0)
    expect((await (await auth.handler(request('get-session', undefined, cookie))).json()).user.id).toBe('admin-a')
    await withActor(db, 'admin-a', A, (tx, actor) => revokeLogin(tx, actor, 'admin-a', randomUUID()))
    expect(await (await auth.handler(request('get-session', undefined, cookie))).json()).toBeNull()
    expect((await pg.query(`SELECT id FROM auth_session WHERE user_id='admin-a'`)).rows).toEqual([])
    const secondLogin = await auth.handler(request('sign-in/email', { email: 'admin-a@example.test', password, rememberMe: false }))
    expect(secondLogin.status).toBe(200)
    const expiredCookie = secondLogin.headers.get('set-cookie')!.split(';')[0]!
    await pg.exec(`UPDATE auth_session SET expires_at=now()-interval '1 minute' WHERE user_id='admin-a'`)
    expect(await (await auth.handler(request('get-session', undefined, expiredCookie))).json()).toBeNull()
  })

  it('[IAM-001/002][ORG-002] admin provisions pending identities; role/Unit grants remain scoped', async () => {
    const input = { name: 'Invited operator', email: 'invited@example.test', grants: [{ role: 'operator', scope: 'unit', unitId: A1 }] }
    await expect(withActor(db, 'operator-a', A, (tx, actor) => createUser(tx, actor, input, randomUUID()))).rejects.toThrow()
    await expect(withActor(db, 'admin-a', A, (tx, actor) => createUser(tx, actor, { ...input, grants: [{ role: 'operator', scope: 'unit', unitId: B1 }] }, randomUUID()))).rejects.toThrow()
    const invite = await withActor(db, 'admin-a', A, (tx, actor) => createUser(tx, actor, input, randomUUID()))
    const listed = await withActor(db, 'admin-a', A, (tx, actor) => listUsers(tx, actor, {}))
    expect(listed.find(item => item.id === invite.userId)).toMatchObject({ active: false, pending: true, grants: input.grants })
    expect(listed.some(item => item.id === 'user-b')).toBe(false)
    await expect(withActor(db, 'operator-a', A, (tx, actor) => listUsers(tx, actor, {}))).rejects.toThrow()
    await expect(withActor(db, 'admin-a', B, (tx, actor) => listUsers(tx, actor, {}))).rejects.toThrow()
    const stored = await pg.query<{ value: string; hours: number }>('SELECT value, extract(epoch FROM (expires_at-created_at))/3600 AS hours FROM auth_verification WHERE identifier=$1', ['enginedes.activation.' + invite.userId])
    expect(stored.rows[0]!.value).not.toBe(invite.token)
    expect(Number(stored.rows[0]!.hours)).toBeCloseTo(24, 1)
    await expect(withActor(db, invite.userId, A, listUnits)).rejects.toThrow()
  })

  it('[IAM-001][AUDIT-001] resend invalidates old link; activation is atomic, single-use and creates a working login', async () => {
    const invite = await withActor(db, 'admin-a', A, (tx, actor) => createUser(tx, actor, { name: 'Activation', email: 'activate@example.test', grants: [{ role: 'operator', scope: 'unit', unitId: A1 }] }, randomUUID()))
    const next = await withActor(db, 'admin-a', A, (tx, actor) => resendInvitation(tx, actor, invite.userId, randomUUID()))
    await expect(activateAccount(db, { userId: invite.userId, token: invite.token, password }, randomUUID())).rejects.toThrow()
    await expect(activateAccount(db, { userId: invite.userId, token: next.token, password }, 'invalid-request-id')).rejects.toThrow()
    expect((await pg.query('SELECT id FROM auth_account WHERE user_id=$1', [invite.userId])).rows).toEqual([])
    await activateAccount(db, { userId: invite.userId, token: next.token, password }, randomUUID())
    expect((await pg.query<{ email_verified: boolean }>('SELECT email_verified FROM auth_user WHERE id=$1', [invite.userId])).rows[0]?.email_verified).toBe(true)
    await expect(activateAccount(db, { userId: invite.userId, token: next.token, password }, randomUUID())).rejects.toThrow()
    const login = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, body: JSON.stringify({ email: invite.email, password, rememberMe: false }) }))
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    expect((await withActor(db, invite.userId, A, listUnits)).map(unit => unit.id)).toEqual([A1])
    await withActor(db, 'admin-a', A, (tx, actor) => setAccountActive(tx, actor, invite.userId, { active: false }, randomUUID()))
    expect((await pg.query('SELECT id FROM auth_session WHERE user_id=$1', [invite.userId])).rows).toEqual([])
    const current = await auth.handler(new Request('http://localhost:3000/api/auth/get-session', { headers: { cookie } }))
    expect(await current.json()).toBeNull()
    await expect(withActor(db, invite.userId, A, listUnits)).rejects.toThrow()
    await withActor(db, 'admin-a', A, (tx, actor) => setAccountActive(tx, actor, invite.userId, { active: true }, randomUUID()))
    await withActor(db, 'admin-a', A, (tx, actor) => updateGrants(tx, actor, invite.userId, { grants: [{ role: 'supervisor', scope: 'unit', unitId: A2 }] }, randomUUID()))
    expect((await withActor(db, invite.userId, A, listUnits)).map(unit => unit.id)).toEqual([A2])
  })

  it('[IAM-001][AUDIT-001] expired activation and manual pending enable are denied', async () => {
    const invite = await withActor(db, 'admin-a', A, (tx, actor) => createUser(tx, actor, { name: 'Expired', email: 'expired@example.test', grants: [{ role: 'operator', scope: 'unit', unitId: A1 }] }, randomUUID()))
    await pg.exec("UPDATE auth_verification SET expires_at=now()-interval '1 minute'")
    await expect(activateAccount(db, { userId: invite.userId, token: invite.token, password }, randomUUID())).rejects.toThrow()
    await expect(withActor(db, 'admin-a', A, (tx, actor) => setAccountActive(tx, actor, invite.userId, { active: true }, randomUUID()))).rejects.toThrow('mengaktivasi')
  })

  it('[IAM-001/002][AUDIT-001] direct activation requires tenant admin, audits issuance and preserves recipient password choice', async () => {
    const invite = await withActor(db, 'admin-a', A, (tx, actor) => createUser(tx, actor, { name: 'Direct activation', email: 'direct@example.test', grants: [{ role: 'operator', scope: 'unit', unitId: A1 }] }, randomUUID()))
    await expect(withActor(db, 'operator-a', A, (tx, actor) => issueManualActivation(tx, actor, invite.userId, randomUUID()))).rejects.toThrow()
    await expect(withActor(db, 'admin-a', A, (tx, actor) => issueManualActivation(tx, actor, 'user-b', randomUUID()))).rejects.toThrow('Target not in tenant')
    await expect(withActor(db, 'admin-a', B, (tx, actor) => issueManualActivation(tx, actor, invite.userId, randomUUID()))).rejects.toThrow()
    await expect(withActor(db, 'admin-a', A, (tx, actor) => issueManualActivation(tx, actor, invite.userId, 'invalid-audit'))).rejects.toThrow()
    await expect(withActor(db, 'admin-a', A, async (tx, actor) => {
      await tx.execute(sql`DELETE FROM role_grants WHERE membership_id=${MA}`)
      return issueManualActivation(tx, actor, invite.userId, randomUUID())
    })).rejects.toThrow('Permission or scope denied')
    // Rollback preserves the existing email token instead of leaving the recipient stranded.
    expect((await pg.query<{ count: number }>('SELECT count(*)::int AS count FROM auth_verification WHERE identifier=$1', ['enginedes.activation.' + invite.userId])).rows[0]?.count).toBe(1)
    const requestId = randomUUID()
    const manual = await withActor(db, 'admin-a', A, (tx, actor) => issueManualActivation(tx, actor, invite.userId, requestId))
    const stored = await pg.query<{ value: string; hours: number }>('SELECT value, extract(epoch FROM (expires_at-created_at))/3600 AS hours FROM auth_verification WHERE identifier=$1', ['enginedes.activation.manual.' + invite.userId])
    expect(stored.rows[0]?.value).not.toBe(manual.token)
    expect(Number(stored.rows[0]?.hours)).toBeCloseTo(24, 1)
    expect((await pg.query('SELECT id FROM auth_account WHERE user_id=$1', [invite.userId])).rows).toEqual([])
    await expect(withActor(db, invite.userId, A, listUnits)).rejects.toThrow()
    await expect(activateAccount(db, { userId: invite.userId, token: invite.token, password }, randomUUID())).rejects.toThrow()
    await withActor(db, 'admin-a', A, async tx => {
      const audits = rowsOf(await tx.execute(sql`SELECT actor_id,request_id,after FROM audit_events WHERE entity_id=${invite.userId} AND action='account.activation_link_issued'`))
      expect(audits).toEqual([{ actor_id: 'admin-a', request_id: requestId, after: { delivery: 'manual', expiresInHours: 24 } }])
      expect(JSON.stringify(audits)).not.toContain(manual.token)
    })
    await expect(activateAccount(db, { ...manual, password: 'too-short' }, randomUUID())).rejects.toThrow()
    await expect(activateAccount(db, { ...manual, password }, 'invalid-audit')).rejects.toThrow()
    expect((await pg.query('SELECT id FROM auth_account WHERE user_id=$1', [invite.userId])).rows).toEqual([])
    await activateAccount(db, { ...manual, password }, randomUUID())
    expect((await pg.query<{ email_verified: boolean }>('SELECT email_verified FROM auth_user WHERE id=$1', [invite.userId])).rows[0]?.email_verified).toBe(false)
    await expect(activateAccount(db, { ...manual, password }, randomUUID())).rejects.toThrow()
    await expect(withActor(db, 'admin-a', A, (tx, actor) => issueManualActivation(tx, actor, invite.userId, randomUUID()))).rejects.toThrow('menunggu aktivasi')
    const login = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, body: JSON.stringify({ email: invite.email, password, rememberMe: false }) }))
    expect(login.status).toBe(200)
    expect((await withActor(db, invite.userId, A, listUnits)).map(unit => unit.id)).toEqual([A1])
  })
  it('[IAM-001][AUDIT-001] manual/email issuance replace each other; expired manual tokens fail', async () => {
    const invite = await withActor(db, 'admin-a', A, (tx, actor) => createUser(tx, actor, { name: 'Manual expiry', email: 'manual-expiry@example.test', grants: [{ role: 'operator', scope: 'unit', unitId: A1 }] }, randomUUID()))
    const first = await withActor(db, 'admin-a', A, (tx, actor) => issueManualActivation(tx, actor, invite.userId, randomUUID()))
    const second = await withActor(db, 'admin-a', A, (tx, actor) => issueManualActivation(tx, actor, invite.userId, randomUUID()))
    await expect(activateAccount(db, { ...first, password }, randomUUID())).rejects.toThrow()
    const email = await withActor(db, 'admin-a', A, (tx, actor) => resendInvitation(tx, actor, invite.userId, randomUUID()))
    await expect(activateAccount(db, { ...second, password }, randomUUID())).rejects.toThrow()
    const latest = await withActor(db, 'admin-a', A, (tx, actor) => issueManualActivation(tx, actor, invite.userId, randomUUID()))
    await expect(activateAccount(db, { userId: email.userId, token: email.token, password }, randomUUID())).rejects.toThrow()
    await pg.query("UPDATE auth_verification SET expires_at=now()-interval '1 minute' WHERE identifier=$1", ['enginedes.activation.manual.' + invite.userId])
    await expect(activateAccount(db, { ...latest, password }, randomUUID())).rejects.toThrow()
  })

  it('[IAM-001/002][AUDIT-001] last admin, cross-tenant targets and invalid grant escalation are protected', async () => {
    await expect(withActor(db, 'admin-a', A, (tx, actor) => setAccountActive(tx, actor, 'admin-a', { active: false }, randomUUID()))).rejects.toThrow('admin aktif')
    await expect(withActor(db, 'admin-a', A, (tx, actor) => updateGrants(tx, actor, 'admin-a', { grants: [{ role: 'operator', scope: 'tenant', unitId: null }] }, randomUUID()))).rejects.toThrow('admin aktif')
    await expect(withActor(db, 'admin-a', A, (tx, actor) => setAccountActive(tx, actor, 'user-b', { active: false }, randomUUID()))).rejects.toThrow('Target not in tenant')
    await expect(withActor(db, 'admin-a', A, (tx, actor) => updateGrants(tx, actor, 'operator-a', { grants: [{ role: 'admin', scope: 'unit', unitId: A1 }] }, randomUUID()))).rejects.toThrow()
    await expect(withActor(db, 'admin-a', A, (tx, actor) => updateGrants(tx, actor, 'operator-a', { grants: [{ role: 'operator', scope: 'unit', unitId: B1 }] }, randomUUID()))).rejects.toThrow()
    expect((await withActor(db, 'admin-a', A, (tx, actor) => listUsers(tx, actor, {}))).find(u => u.id === 'admin-a')?.active).toBe(true)
  })

  it('[AUDIT-001][CFG-001] user provisioning and profile edits roll back on audit failure', async () => {
    const input = { name: 'Rollback', email: 'rollback-user@example.test', grants: [{ role: 'operator', scope: 'tenant', unitId: null }] }
    await expect(withActor(db, 'admin-a', A, (tx, actor) => createUser(tx, actor, input, 'invalid'))).rejects.toThrow()
    expect((await pg.query('SELECT id FROM auth_user WHERE email=$1', [input.email])).rows).toEqual([])
    await expect(withActor(db, 'operator-a', A, (tx, actor) => updateOrganization(tx, actor, { name: 'Denied' }, randomUUID()))).rejects.toThrow()
    await expect(withActor(db, 'admin-a', A, (tx, actor) => updateOrganization(tx, actor, { name: 'Rollback tenant' }, 'invalid'))).rejects.toThrow()
    await withActor(db, 'admin-a', A, (tx, actor) => updateOrganization(tx, actor, { name: 'BUMDes A updated' }, randomUUID()))
    expect((await withActor(db, 'admin-a', A, tx => tx.select({ name: schema.tenants.name }).from(schema.tenants))).map(t => t.name)).toEqual(['BUMDes A updated'])
  })

  it('[NFR-SEC-002] membership mutation requires matching tenant context independently of actor discovery', async () => {
    await expect(withActor(db, 'admin-a', A, tx => tx.execute(sql`INSERT INTO memberships(tenant_id,user_id) VALUES (${B},'admin-a')`))).rejects.toThrow()
    await withActor(db, 'admin-a', A, async tx => {
      expect(rowsOf(await tx.execute(sql`UPDATE memberships SET active=false WHERE tenant_id=${B} RETURNING id`))).toEqual([])
    })
  })

  it.runIf(!!process.env.TEST_RUNTIME_DATABASE_URL)('[IAM-001][NFR-REL-001] concurrent admin disable preserves one active admin on network PostgreSQL', async () => {
    const invite = await withActor(db, 'admin-a', A, (tx, actor) => createUser(tx, actor, { name: 'Concurrent admin', email: 'concurrent@example.test', grants: [{ role: 'admin', scope: 'tenant', unitId: null }] }, randomUUID()))
    await activateAccount(db, { userId: invite.userId, token: invite.token, password }, randomUUID())
    const runtimeUrl = new URL(process.env.TEST_RUNTIME_DATABASE_URL!)
    if (!runtimeUrl.pathname.endsWith('_test') || runtimeUrl.pathname !== new URL(process.env.TEST_DATABASE_URL!).pathname) throw new Error('Concurrency runtime must use the same disposable test database')
    const connection = postgres(runtimeUrl.toString(), { max: 2 })
    const parallel = postgresDrizzle(connection, { schema })
    try {
      const results = await Promise.allSettled([
        withActor(parallel, 'admin-a', A, (tx, actor) => setAccountActive(tx, actor, 'admin-a', { active: false }, randomUUID())),
        withActor(parallel, invite.userId, A, (tx, actor) => setAccountActive(tx, actor, invite.userId, { active: false }, randomUUID())),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
      if (results[0]!.status === 'fulfilled') await withActor(parallel, invite.userId, A, (tx, actor) => setAccountActive(tx, actor, 'admin-a', { active: true }, randomUUID()))
      await withActor(parallel, 'admin-a', A, (tx, actor) => setAccountActive(tx, actor, invite.userId, { active: false }, randomUUID()))
    } finally { await connection.end() }
  })
  it('[ORG-002][IAM-002] Location assignment cannot leak to another Location or whole-Unit commands', async () => {
    const location = await withActor(db,'admin-a',A,(tx,actor)=>createLocation(tx,actor,{unitId:A1,name:'Primary',code:'LOC1'},randomUUID()))
    const other = await withActor(db,'admin-a',A,(tx,actor)=>createLocation(tx,actor,{unitId:A1,name:'Other',code:'LOC2'},randomUUID()))
    await expect(withActor(db,'operator-a',A,(tx,actor)=>createLocation(tx,actor,{unitId:A1,name:'Denied',code:'DENIED'},randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'admin-a',A,(tx,actor)=>createLocation(tx,actor,{unitId:B1,name:'Denied',code:'CROSS'},randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'admin-a',A,(tx,actor)=>updateGrants(tx,actor,'operator-a',{grants:[{role:'operator',scope:'unit',unitId:A2,locationId:location.id}]},randomUUID()))).rejects.toThrow()
    await withActor(db,'admin-a',A,(tx,actor)=>updateGrants(tx,actor,'operator-a',{grants:[{role:'operator',scope:'unit',unitId:A1,locationId:location.id}]},randomUUID()))
    expect((await withActor(db,'operator-a',A,listLocations)).map(l=>l.id)).toEqual([location.id])
    await withActor(db,'admin-a',A,(tx,actor)=>setConfiguration(tx,actor,{key:'customer:location_cash',value:{anonymousAllowed:true},expectedRevision:0},randomUUID()))
    const context={type:'location_cash',unitId:A1,partyId:null,createsAR:false}
    await expect(withActor(db,'operator-a',A,(tx,actor)=>validateTransactionContext(tx,actor,context))).rejects.toThrow()
    await expect(withActor(db,'operator-a',A,(tx,actor)=>validateTransactionContext(tx,actor,{...context,locationId:other.id}))).rejects.toThrow()
    expect(await withActor(db,'operator-a',A,(tx,actor)=>validateTransactionContext(tx,actor,{...context,locationId:location.id}))).toMatchObject({locationId:location.id,tenantId:A})
    await expect(withActor(db,'admin-a',A,tx=>tx.execute(sql`INSERT INTO role_grants(tenant_id,membership_id,role,scope,unit_id,location_id) VALUES (${A},${MO},'operator','unit',${A2},${location.id})`))).rejects.toThrow()
    await withActor(db,'admin-a',A,(tx,actor)=>updateGrants(tx,actor,'operator-a',{grants:[{role:'operator',scope:'unit',unitId:A1},{role:'operator',scope:'unit',unitId:A2}]},randomUUID()))
  })
  it('[PARTY-001/002][AUDIT-001] one identity supports Person/Organization and multiple roles with atomic audit', async () => {
    const data={kind:'organization',name:'Supplier Customer',code:'PARTY-A',roles:[{role:'vendor',unitId:null},{role:'customer',unitId:A1}]}
    const party=await withActor(db,'admin-a',A,(tx,actor)=>saveParty(tx,actor,undefined,data,randomUUID()))
    expect(party.roles).toHaveLength(2)
    const updated=await withActor(db,'admin-a',A,(tx,actor)=>saveParty(tx,actor,party.id,{...data,name:'Changed name'},randomUUID()))
    expect(updated.id).toBe(party.id)
    expect((await withActor(db,'operator-a',A,(tx,actor)=>listParties(tx,actor,{unitId:A1}))).find(p=>p.id===party.id)?.roles).toHaveLength(2)
    await expect(withActor(db,'operator-a',A,(tx,actor)=>listParties(tx,actor,{}))).rejects.toThrow()
    await expect(withActor(db,'admin-a',A,(tx,actor)=>saveParty(tx,actor,undefined,{...data,code:'ROLLBACK-PARTY'},'invalid'))).rejects.toThrow()
    await withActor(db,'admin-a',A,async tx=>{expect(rowsOf(await tx.execute(sql`SELECT id FROM parties WHERE code='ROLLBACK-PARTY'`))).toEqual([])})
    await expect(withActor(db,'operator-a',A,(tx,actor)=>saveParty(tx,actor,undefined,data,randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'admin-a',A,(tx,actor)=>saveParty(tx,actor,undefined,{...data,code:'BAD-UNIT',roles:[{role:'customer',unitId:B1}]},randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'user-b',B,tx=>tx.execute(sql`INSERT INTO party_roles(tenant_id,party_id,role) VALUES (${B},${party.id},'vendor')`))).rejects.toThrow()
    expect((await pg.query('SELECT * FROM parties')).rows).toEqual([])
  })
  it('[ORG-003][PARTY-003/004] scope and customer policy gate the business write; AR requires Party', async () => {
    await withActor(db,'admin-a',A,(tx,actor)=>setConfiguration(tx,actor,{key:'customer:retail_cash',value:{anonymousAllowed:true},expectedRevision:0},randomUUID()))
    const context={type:'retail_cash',unitId:A1,partyId:null,createsAR:false}
    expect(await withActor(db,'operator-a',A,(tx,actor)=>validateTransactionContext(tx,actor,context))).toMatchObject({partyId:null,unitId:A1})
    await expect(withActor(db,'operator-a',A,(tx,actor)=>validateTransactionContext(tx,actor,{...context,createsAR:true}))).rejects.toThrow('Identified Party required')
    await expect(withActor(db,'operator-a',A,(tx,actor)=>validateTransactionContext(tx,actor,{...context,type:'unconfigured'}))).rejects.toThrow()
    await expect(withActor(db,'operator-a',A,(tx,actor)=>validateTransactionContext(tx,actor,{...context,unitId:B1}))).rejects.toThrow()
    await expect(withActor(db,'operator-a',A,(tx,actor)=>validateTransactionContext(tx,actor,{...context,unitId:null}))).rejects.toThrow()
    const party=await withActor(db,'admin-a',A,(tx,actor)=>saveParty(tx,actor,undefined,{kind:'person',name:'AR Customer',code:'AR-CUST',roles:[{role:'customer',unitId:A1}]},randomUUID()))
    expect((await withActor(db,'operator-a',A,(tx,actor)=>listParties(tx,actor,{unitId:A2}))).some(row=>row.id===party.id)).toBe(false)
    expect(await withActor(db,'operator-a',A,(tx,actor)=>validateTransactionContext(tx,actor,{...context,partyId:party.id,createsAR:true}))).toMatchObject({partyId:party.id})
    await expect(withActor(db,'operator-a',A,(tx,actor)=>validateTransactionContext(tx,actor,{...context,unitId:A2,partyId:party.id,createsAR:true}))).rejects.toThrow()
    await expect(withActor(db,'operator-a',A,async(tx,actor)=>{
      await tx.execute(sql`INSERT INTO units(tenant_id,name,code) VALUES (${A},'Should rollback','CONTEXT-ROLLBACK')`)
      await validateTransactionContext(tx,actor,{...context,createsAR:true})
    })).rejects.toThrow()
    await withActor(db,'admin-a',A,async tx=>{expect(rowsOf(await tx.execute(sql`SELECT id FROM units WHERE code='CONTEXT-ROLLBACK'`))).toEqual([])})
  })
  it('[IAM-003][CFG-001] approval permission is distinct from Admin and separation of duties overrides multiple roles', async () => {
    await withActor(db,'admin-a',A,(tx,actor)=>updateGrants(tx,actor,'operator-a',{grants:[{role:'director',scope:'unit',unitId:A1},{role:'admin',scope:'tenant',unitId:null}]},randomUUID()))
    const document={tenantId:A,unitId:A1,creatorId:'operator-a'}
    await expect(withActor(db,'operator-a',A,(tx,actor)=>requireApproval(tx,actor,document))).rejects.toThrow('Creator cannot approve')
    await expect(withActor(db,'admin-a',A,(tx,actor)=>requireApproval(tx,actor,{...document,creatorId:'someone-else'}))).rejects.toThrow()
    await expect(withActor(db,'operator-a',A,(tx,actor)=>requireApproval(tx,actor,{...document,unitId:A2,creatorId:'someone-else'}))).rejects.toThrow()
    await withActor(db,'operator-a',A,(tx,actor)=>requireApproval(tx,actor,{...document,creatorId:'someone-else'}))
    await withActor(db,'admin-a',A,(tx,actor)=>updateGrants(tx,actor,'operator-a',{grants:[{role:'operator',scope:'unit',unitId:A1},{role:'operator',scope:'unit',unitId:A2}]},randomUUID()))
  })
  it('[CFG-001][AUDIT-001] revision conflict, unauthorized edits and audit rollback preserve configuration', async () => {
    const data={key:'security',value:{timezone:'Asia/Makassar',passwordMinimum:16,separationOfDuties:true},expectedRevision:0}
    await expect(withActor(db,'operator-a',A,(tx,actor)=>setConfiguration(tx,actor,data,randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'admin-a',A,(tx,actor)=>setConfiguration(tx,actor,{...data,value:{...data.value,timezone:'Not/AZone'}},randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'admin-a',A,(tx,actor)=>setConfiguration(tx,actor,data,'bad-audit'))).rejects.toThrow()
    const row=await withActor(db,'admin-a',A,(tx,actor)=>setConfiguration(tx,actor,data,randomUUID()))
    expect(row.revision).toBe(1)
    const invite=await withActor(db,'admin-a',A,(tx,actor)=>createUser(tx,actor,{name:'Policy activation',email:'policy-activation@example.test',grants:[{role:'operator',scope:'unit',unitId:A1}]},randomUUID()))
    await expect(activateAccount(db,{userId:invite.userId,token:invite.token,password:'Twelve-pass-1'},randomUUID())).rejects.toThrow('tenant policy')
    await activateAccount(db,{userId:invite.userId,token:invite.token,password},randomUUID())
    await expect(withActor(db,'admin-a',A,(tx,actor)=>setConfiguration(tx,actor,data,randomUUID()))).rejects.toThrow('telah berubah')
    await expect(pg.exec('DELETE FROM configuration_revisions')).rejects.toThrow()
    await expect(withActor(db,'operator-a',A,listConfigurations)).rejects.toThrow()
    await withActor(db,'admin-a',A,(tx,actor)=>setConfiguration(tx,actor,{...data,value:{...data.value,passwordMinimum:12},expectedRevision:1},randomUUID()))
  })
  it('[SEQ-001][AUDIT-001] allocation retry preserves number, mismatched retry and audit rollback consume no counter', async () => {
    await withActor(db,'admin-a',A,(tx,actor)=>setConfiguration(tx,actor,{key:'sequence:test_doc',value:{prefix:'TEST',scope:'tenant',reset:'year'},expectedRevision:0},randomUUID()))
    const data={type:'test_doc',commandId:randomUUID(),unitId:A1,period:'2026'}
    const first=await withActor(db,'operator-a',A,(tx,actor)=>allocateNumber(tx,actor,data,randomUUID()))
    const retry=await withActor(db,'operator-a',A,(tx,actor)=>allocateNumber(tx,actor,data,randomUUID()))
    expect(first.number).toBe('TEST/2026/000001');expect(retry.id).toBe(first.id)
    await expect(withActor(db,'operator-a',A,(tx,actor)=>allocateNumber(tx,actor,{...data,unitId:A2},randomUUID()))).rejects.toThrow('Retry context')
    await expect(withActor(db,'operator-a',A,(tx,actor)=>allocateNumber(tx,actor,{...data,commandId:randomUUID()},'invalid'))).rejects.toThrow()
    const second=await withActor(db,'operator-a',A,(tx,actor)=>allocateNumber(tx,actor,{...data,commandId:randomUUID()},randomUUID()))
    expect(second.number).toBe('TEST/2026/000002')
    await expect(pg.exec("UPDATE document_numbers SET number=''")).rejects.toThrow()
    await expect(withActor(db,'operator-a',A,(tx,actor)=>allocateNumber(tx,actor,{...data,commandId:randomUUID(),period:'not-year'},randomUUID()))).rejects.toThrow()
  })
  it('[ORG-001][PARTY-001][AUDIT-001] dummy seed is idempotent and leaves users pending without demo passwords', async () => {
    const first=await seedDummy(db,'admin-a',A),second=await seedDummy(db,'admin-a',A)
    expect(first.created).toBe(40);expect(second.created).toBe(0)
    expect(first.ledgerAccounts).toBe(5);expect(first.accountingMappings).toBe(7);expect(first.billingSequences).toBe(3)
    expect(first.procurementSequences).toBe(3);expect(first.procurementItems).toBe(3)
    expect(await withActor(db,'admin-a',A,tx=>tx.select().from(schema.journals))).toEqual([])
    const users=await withActor(db,'admin-a',A,tx=>tx.execute(sql`SELECT m.pending,m.active FROM memberships m JOIN auth_user u ON u.id=m.user_id WHERE u.email LIKE 'demo.%@example.test'`))
    const seededUsers=rowsOf(users) as {pending:boolean;active:boolean}[]
    expect(seededUsers).toHaveLength(3);expect(seededUsers.every(u=>u.pending&&!u.active)).toBe(true)
    expect((await pg.query("SELECT a.id FROM auth_account a JOIN auth_user u ON u.id=a.user_id WHERE u.email LIKE 'demo.%@example.test'")).rows).toEqual([])
    await pg.exec('RESET ROLE')
    await pg.query("UPDATE role_grants SET role='admin' WHERE membership_id=$1",[MB])
    await pg.exec('SET ROLE enginedes_app')
    try {
      await expect(seedDummy(db,'user-b',B)).rejects.toThrow('DEMO email collision')
      await withActor(db,'user-b',B,async tx=>{expect(rowsOf(await tx.execute(sql`SELECT id FROM units WHERE code LIKE 'DEMO-%'`))).toEqual([])})
    } finally {
      await pg.exec('RESET ROLE')
      await pg.query("UPDATE role_grants SET role='operator' WHERE membership_id=$1",[MB])
      await pg.exec('SET ROLE enginedes_app')
    }
  })
  it.runIf(!!process.env.TEST_RUNTIME_DATABASE_URL)('[SEQ-001] concurrent network PostgreSQL document creation produces unique numbers and identical retry results', async () => {
    const connection=postgres(process.env.TEST_RUNTIME_DATABASE_URL!,{max:8}),parallel=postgresDrizzle(connection,{schema})
    try {
      const data={type:'test_doc',unitId:A1,period:'2026'}
      const results=await Promise.all(Array.from({length:20},()=>withActor(parallel,'operator-a',A,(tx,actor)=>allocateNumber(tx,actor,{...data,commandId:randomUUID()},randomUUID()))))
      expect(new Set(results.map(r=>r.number)).size).toBe(20)
      const commandId=randomUUID()
      const retries=await Promise.all(Array.from({length:8},()=>withActor(parallel,'operator-a',A,(tx,actor)=>allocateNumber(tx,actor,{...data,commandId},randomUUID()))))
      expect(new Set(retries.map(r=>r.id)).size).toBe(1)
    }finally{await connection.end()}
  })

  it('[ACC-001/002/004][MAP-001..004][ORG-003] mapped event posts balanced IDR journal and reconciles ledger', async () => {
    const cash=await withActor(db,'admin-a',A,(tx,a)=>createLedgerAccount(tx,a,{code:'1100',name:'Kas',kind:'asset'},randomUUID()))
    const revenue=await withActor(db,'admin-a',A,(tx,a)=>createLedgerAccount(tx,a,{code:'4100',name:'Pendapatan',kind:'revenue'},randomUUID()))
    await withActor(db,'admin-a',A,(tx,a)=>setConfiguration(tx,a,{key:'customer:sale',value:{anonymousAllowed:true},expectedRevision:0},randomUUID()))
    await withActor(db,'admin-a',A,(tx,a)=>setAccountingMapping(tx,a,{eventType:'sale',schemaVersion:1,expectedRevision:0,rules:[
      {accountId:cash.id,side:'debit',amountKey:'total',unitDimension:'event_unit'},
      {accountId:revenue.id,side:'credit',amountKey:'total',unitDimension:'event_unit'}]},randomUUID()))
    const event={eventId:randomUUID(),eventType:'sale',schemaVersion:1,bookDate:'2026-09-28',unitId:A1,locationId:null,partyId:null,createsAR:false,amounts:{total:'125000'}}
    await expect(withActor(db,'admin-a',A,(tx,a)=>postBusinessEvent(tx,a,event,randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'finance-a',B,(tx,a)=>postBusinessEvent(tx,a,event,randomUUID()))).rejects.toThrow()
    const first=await withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,event,randomUUID()))
    const retry=await withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,event,randomUUID()))
    expect(retry.id).toBe(first.id)
    await expect(withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,{...event,amounts:{total:'125001'}},randomUUID()))).rejects.toThrow('payload berbeda')
    await expect(withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,{...event,eventId:randomUUID(),amounts:{total:'1.5'}},randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,{...event,eventId:randomUUID(),amounts:{total:'10',fee:'2'}},randomUUID()))).rejects.toThrow('belum seluruhnya dipetakan')
    const balance=await withActor(db,'finance-a',A,(tx,a)=>trialBalance(tx,a,{through:'2026-09-30',unitId:A1}))
    expect(balance.map(b=>[b.code,b.debit,b.credit])).toEqual([['1100','125000','0'],['4100','0','125000']])
    const entries=await withActor(db,'finance-a',A,(tx,a)=>ledger(tx,a,{accountId:cash.id,from:'2026-09-01',through:'2026-09-30',unitId:A1}))
    expect(entries.openingBalance).toBe('0')
    expect(entries.entries).toHaveLength(1)
    expect(entries.entries[0]?.runningBalance).toBe('125000')
    await expect(withActor(db,'finance-a',A,tx=>tx.execute(sql`UPDATE journals SET event_type='x' WHERE id=${first.id}`))).rejects.toThrow()
    await expect(withActor(db,'finance-a',A,tx=>tx.execute(sql`INSERT INTO journal_lines(tenant_id,journal_id,line_no,account_id,unit_id,debit,credit) VALUES (${A},${first.id},3,${cash.id},${A1},1,0)`))).rejects.toThrow()
    await expect(withActor(db,'finance-a',A,tx=>tx.execute(sql`INSERT INTO journal_lines(tenant_id,journal_id,line_no,account_id,unit_id,debit,credit) VALUES (${B},${first.id},3,${cash.id},${A1},1,0)`))).rejects.toThrow()
    await expect(withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,{...event,eventId:randomUUID(),unitId:B1},randomUUID()))).rejects.toThrow()
  })
  it('[ACC-002][IAM-002][MAP-003] Unit-scoped finance cannot post or read another Unit', async () => {
    const event={eventId:randomUUID(),eventType:'sale',schemaVersion:1,bookDate:'2026-10-04',unitId:A1,locationId:null,partyId:null,createsAR:false,amounts:{total:'18'}}
    const own=await withActor(db,'finance-unit-a',A,(tx,a)=>postBusinessEvent(tx,a,event,randomUUID()))
    expect(own.id).toBeTruthy()
    await expect(withActor(db,'finance-unit-a',A,(tx,a)=>postBusinessEvent(tx,a,{...event,eventId:randomUUID(),unitId:A2},randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'finance-unit-a',A,(tx,a)=>trialBalance(tx,a,{through:'2026-10-31'}))).rejects.toThrow()
    const ownBalance=await withActor(db,'finance-unit-a',A,(tx,a)=>trialBalance(tx,a,{through:'2026-10-31',unitId:A1}))
    expect(ownBalance.find(row=>row.code==='1100')?.debit).toBe('125018')
  })
  it('[MAP-001/003][PARTY-002] vendor event resolves configured accounts without customer policy', async () => {
    const vendor=await withActor(db,'admin-a',A,(tx,a)=>saveParty(tx,a,undefined,{code:'TEST-VENDOR',name:'Supplier Test',kind:'organization',roles:[{role:'vendor',unitId:null}]},randomUUID()))
    const [cash]=await withActor(db,'admin-a',A,tx=>tx.select().from(schema.ledgerAccounts).where(eq(schema.ledgerAccounts.code,'1100')))
    const expense=await withActor(db,'admin-a',A,(tx,a)=>createLedgerAccount(tx,a,{code:'5100',name:'Beban Pengadaan',kind:'expense'},randomUUID()))
    await expect(withActor(db,'finance-a',A,(tx,a)=>setAccountingMapping(tx,a,{eventType:'purchase',schemaVersion:1,expectedRevision:0,rules:[
      {accountId:expense.id,side:'debit',amountKey:'total',unitDimension:'event_unit'},
      {accountId:cash!.id,side:'credit',amountKey:'total',unitDimension:'event_unit'}]},randomUUID()))).rejects.toThrow()
    await withActor(db,'admin-a',A,(tx,a)=>setAccountingMapping(tx,a,{eventType:'purchase',schemaVersion:1,expectedRevision:0,rules:[
      {accountId:expense.id,side:'debit',amountKey:'total',unitDimension:'event_unit'},
      {accountId:cash!.id,side:'credit',amountKey:'total',unitDimension:'event_unit'}]},randomUUID()))
    const event={eventId:randomUUID(),eventType:'purchase',schemaVersion:1,bookDate:'2026-10-06',unitId:A1,locationId:null,partyId:vendor.id,partyRole:'vendor',createsAR:false,amounts:{total:'750'}}
    await expect(withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,{...event,partyId:null},randomUUID()))).rejects.toThrow('Vendor')
    const posted=await withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,event,randomUUID()))
    expect(posted.mappingRevision).toBe(1)
    const lines=await withActor(db,'finance-a',A,tx=>tx.select().from(schema.journalLines).where(eq(schema.journalLines.journalId,posted.id)))
    expect(lines.map(l=>[l.accountId,l.unitId])).toEqual([[expense.id,A1],[cash!.id,A1]])
  })
  it('[ACC-001][MAP-004][LOCK-001][AUDIT-001] invalid mapping, audit rollback and closed period prevent partial journal', async () => {
    const [mapping]=await withActor(db,'admin-a',A,tx=>tx.select().from(schema.accountingMappings).where(eq(schema.accountingMappings.eventType,'sale')))
    const bad=await withActor(db,'admin-a',A,(tx,a)=>setAccountingMapping(tx,a,{eventType:'sale',schemaVersion:1,expectedRevision:mapping!.revision,rules:[
      {accountId:(mapping!.rules as {accountId:string}[])[0]!.accountId,side:'debit',amountKey:'total',unitDimension:'event_unit'},
      {accountId:(mapping!.rules as {accountId:string}[])[1]!.accountId,side:'credit',amountKey:'other',unitDimension:'event_unit'}]},randomUUID()))
    expect(bad.revision).toBe(2)
    const event={eventId:randomUUID(),eventType:'sale',schemaVersion:1,bookDate:'2026-09-28',unitId:A1,locationId:null,partyId:null,createsAR:false,amounts:{total:'5'}}
    await expect(withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,event,randomUUID()))).rejects.toThrow('Nilai untuk mapping')
    await withActor(db,'admin-a',A,(tx,a)=>setAccountingMapping(tx,a,{eventType:'sale',schemaVersion:1,expectedRevision:2,rules:mapping!.rules},randomUUID()))
    await expect(withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,event,'invalid'))).rejects.toThrow()
    const count=await withActor(db,'finance-a',A,tx=>tx.select().from(schema.journals).where(eq(schema.journals.eventId,event.eventId)))
    expect(count).toHaveLength(0)
    const closed=await withActor(db,'finance-a',A,(tx,a)=>closeAccountingPeriod(tx,a,'2026-09',randomUUID()))
    await expect(withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,event,randomUUID()))).rejects.toThrow('ditutup')
    try {
      await withActor(db,'finance-a',A,tx=>tx.execute(sql`INSERT INTO journals(tenant_id,event_id,fingerprint,event_type,schema_version,book_date,kind,actor_id) VALUES (${A},${randomUUID()},'direct','direct',1,'2026-09-28','normal','finance-a')`))
      throw new Error('Direct locked-period insert unexpectedly succeeded')
    } catch(error) {
      expect(String((error as {cause?:Error}).cause || error)).toContain('Accounting period is closed')
    }
    await expect(withActor(db,'finance-a',A,tx=>tx.execute(sql`DELETE FROM accounting_periods WHERE id=${closed.id}`))).rejects.toThrow()
  })
  it('[ACC-003][IAM-002] Unit-scoped correction cannot reference another Unit journal', async () => {
    const event={eventId:randomUUID(),eventType:'sale',schemaVersion:1,bookDate:'2026-10-07',unitId:A2,locationId:null,partyId:null,createsAR:false,amounts:{total:'100'}}
    const original=await withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,event,randomUUID()))
    const [cash,revenue]=await withActor(db,'admin-a',A,tx=>tx.select().from(schema.ledgerAccounts).where(sql`${schema.ledgerAccounts.code} IN ('1100','4100')`).orderBy(schema.ledgerAccounts.code))
    await expect(withActor(db,'finance-unit-a',A,(tx,a)=>reverseJournal(tx,a,{eventId:randomUUID(),bookDate:'2026-10-08',originalJournalId:original.id},randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'finance-unit-a',A,(tx,a)=>adjustJournal(tx,a,{eventId:randomUUID(),bookDate:'2026-10-08',originalJournalId:original.id,lines:[
      {accountId:cash!.id,unitId:A1,side:'debit',amount:'100'},
      {accountId:revenue!.id,unitId:A1,side:'credit',amount:'100'}]},randomUUID()))).rejects.toThrow()
  })
  it('[ACC-003/005] reversal and adjustment append references in an open period', async () => {
    const [original]=await withActor(db,'finance-a',A,tx=>tx.select().from(schema.journals).where(eq(schema.journals.eventType,'sale')))
    const reversed=await withActor(db,'finance-a',A,(tx,a)=>reverseJournal(tx,a,{eventId:randomUUID(),bookDate:'2026-10-01',originalJournalId:original!.id},randomUUID()))
    expect(reversed.correctsId).toBe(original!.id)
    const source=await withActor(db,'finance-a',A,tx=>tx.select().from(schema.journalLines).where(eq(schema.journalLines.journalId,original!.id)))
    const adjustment=await withActor(db,'finance-a',A,(tx,a)=>adjustJournal(tx,a,{eventId:randomUUID(),bookDate:'2026-10-02',originalJournalId:original!.id,lines:[
      {accountId:source[0]!.accountId,unitId:A1,side:'debit',amount:'10'},
      {accountId:source[1]!.accountId,unitId:A1,side:'credit',amount:'10'}]},randomUUID()))
    expect(adjustment.correctsId).toBe(original!.id)
    await expect(withActor(db,'finance-a',A,(tx,a)=>reverseJournal(tx,a,{eventId:randomUUID(),bookDate:'2026-10-03',originalJournalId:original!.id},randomUUID()))).rejects.toThrow()
  })

  it.runIf(!!process.env.TEST_RUNTIME_DATABASE_URL)('[ACC-001/005][MAP-004] concurrent retry and close serialize on real PostgreSQL', async () => {
    const connection=postgres(process.env.TEST_RUNTIME_DATABASE_URL!,{max:8}),parallel=postgresDrizzle(connection,{schema})
    try {
      const event={eventId:randomUUID(),eventType:'sale',schemaVersion:1,bookDate:'2026-11-05',unitId:A1,locationId:null,partyId:null,createsAR:false,amounts:{total:'99'}}
      const retries=await Promise.all(Array.from({length:8},()=>withActor(parallel,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,event,randomUUID()))))
      expect(new Set(retries.map(j=>j.id)).size).toBe(1)
      const second={...event,eventId:randomUUID(),bookDate:'2026-12-05'}
      const race=await Promise.allSettled([
        withActor(parallel,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,second,randomUUID())),
        withActor(parallel,'finance-a',A,(tx,a)=>closeAccountingPeriod(tx,a,'2026-12',randomUUID())),
      ])
      expect(race[1].status).toBe('fulfilled')
      const count=await withActor(db,'finance-a',A,tx=>tx.select().from(schema.journals).where(eq(schema.journals.eventId,second.eventId)))
      expect(count.length).toBe(race[0].status==='fulfilled'?1:0)
      await expect(withActor(db,'finance-a',A,(tx,a)=>postBusinessEvent(tx,a,{...second,eventId:randomUUID()},randomUUID()))).rejects.toThrow('ditutup')
    } finally { await connection.end() }
  })
  it('[ACC-001][NFR-SEC-002] database rejects an incomplete or cross-tenant posted journal even with direct SQL', async () => {
    const eventId=randomUUID()
    await expect(withActor(db,'finance-a',A,tx=>tx.execute(sql`INSERT INTO journals(tenant_id,event_id,fingerprint,event_type,schema_version,book_date,kind,actor_id) VALUES (${A},${eventId},'test','direct',1,'2026-10-08','normal','finance-a')`))).rejects.toThrow('Journal is not balanced')
    const exists=await withActor(db,'finance-a',A,tx=>tx.select().from(schema.journals).where(eq(schema.journals.eventId,eventId)))
    expect(exists).toHaveLength(0)
    await expect(withActor(db,'finance-a',A,tx=>tx.execute(sql`INSERT INTO journals(tenant_id,event_id,fingerprint,event_type,schema_version,book_date,kind,actor_id) VALUES (${B},${randomUUID()},'test','direct',1,'2026-10-08','normal','finance-a')`))).rejects.toThrow()
  })

  // ---------------------------------------------------------------------------------------
  // [MBX-8] Cash, billing AR/AP and payment allocation.
  // Only a server-backed PostgreSQL reaches these assertions, because the append-only and
  // balance guards are database triggers that the PGlite WASM fallback cannot run faithfully.
  // ---------------------------------------------------------------------------------------
  it.runIf(!!process.env.TEST_DATABASE_URL)('[MBX-8][CASH-001][BILL-001..003][PAY-001..003] billing and money flow', async () => {
    const tenant=BT, tenantUnit=BU1, tenantUnit2=BU2
    const ledger=(code:string,kind:'asset'|'liability'|'revenue'|'expense')=>withActor(db,'billing-admin',tenant,(tx,a)=>createLedgerAccount(tx,a,{code,name:code,kind},randomUUID()))
    const ar=(await ledger('1200-BIL','asset')).id, ap=(await ledger('2100-BIL','liability')).id
    const revenue=(await ledger('4100-BIL','revenue')).id, expense=(await ledger('5100-BIL','expense')).id
    const kasLedger=(await ledger('1110-BIL','asset')).id, bankLedger=(await ledger('1120-BIL','asset')).id
    const rule=(accountId:string,side:'debit'|'credit')=>({accountId,side,amountKey:'total',unitDimension:'event_unit' as const})
    const map=(eventType:string,rules:unknown[])=>withActor(db,'billing-admin',tenant,(tx,a)=>setAccountingMapping(tx,a,{eventType,schemaVersion:1,expectedRevision:0,rules},randomUUID()))
    await map('invoice_issued',[rule(ar,'debit'),rule(revenue,'credit')])
    await map('bill_received',[rule(expense,'debit'),rule(ap,'credit')])
    await map('payment_received',[rule(ar,'credit'),rule(kasLedger,'debit')])
    // [PAY-003] Refunds mirror the payment they correct: cash received is credited back against
    // receivables, cash paid is debited back against payables. No clearing account is introduced.
    await map('sales_refund',[rule(ar,'debit'),rule(kasLedger,'credit')])
    await map('purchase_refund',[rule(kasLedger,'debit'),rule(ap,'credit')])
    for (const type of ['invoice','bill','payment']) {
      await withActor(db,'billing-admin',tenant,(tx,a)=>setConfiguration(tx,a,{key:'sequence:'+type,value:{prefix:type.toUpperCase(),scope:'unit',reset:'month'},expectedRevision:0},randomUUID()))
    }
    const party=(code:string,role:'customer'|'vendor',name:string)=>withActor(db,'billing-admin',tenant,(tx,a)=>saveParty(tx,a,undefined,{kind:'person',name,code,roles:[{role,unitId:tenantUnit}]},randomUUID()))
    const customer=(await party('BIL-CUST','customer','Pelanggan Billing')).id
    const vendor=(await party('BIL-VEND','vendor','Pemasok Billing')).id
    const agingCustomer=(await party('BIL-AGING','customer','Pelanggan Aging')).id
    const kas=(await withActor(db,'billing-admin',tenant,(tx,a)=>createCashAccount(tx,a,{unitId:tenantUnit,code:'KAS-BIL',name:'Kas Billing',kind:'cash',ledgerAccountId:kasLedger},randomUUID()))).id
    await withActor(db,'billing-admin',tenant,(tx,a)=>createCashAccount(tx,a,{unitId:tenantUnit,code:'BANK-BIL',name:'Bank Billing',kind:'bank',ledgerAccountId:bankLedger},randomUUID()))
    const invoice=(amount:string,bookDate:string,dueDate:string,partyId:string)=>withActor(db,'billing-unit',tenant,(tx,a)=>createFinancialDocument(tx,a,{type:'invoice',unitId:tenantUnit,locationId:null,partyId,bookDate,dueDate,amount,commandId:randomUUID()},randomUUID()))

    // [CASH-001][IAM-002][CFG-001] more than one account; configuration stays with the admin
    // role (as in Phase 2) while Finance only consumes configured accounts.
    const accounts=await withActor(db,'billing-unit',tenant,(tx,a)=>listCashAccounts(tx,a,{unitId:tenantUnit}))
    expect(accounts.map(row=>row.code).sort()).toEqual(['BANK-BIL','KAS-BIL'])
    await expect(withActor(db,'billing-unit',tenant,(tx,a)=>createCashAccount(tx,a,{unitId:tenantUnit,code:'X',name:'X',kind:'cash',ledgerAccountId:ar},randomUUID()))).rejects.toThrow()
    await expect(withActor(db,'billing-admin',tenant,(tx,a)=>createCashAccount(tx,a,{unitId:tenantUnit2,code:'BAD',name:'Bad',kind:'cash',ledgerAccountId:randomUUID()},randomUUID()))).rejects.toThrow('Ledger account unavailable')

    // [BILL-003][PARTY-004] an AR document requires its Customer role; AP requires a Vendor.
    await expect(withActor(db,'billing-unit',tenant,(tx,a)=>createFinancialDocument(tx,a,{type:'invoice',unitId:tenantUnit,locationId:null,partyId:vendor,bookDate:'2026-02-01',dueDate:'2026-03-01',amount:'100000',commandId:randomUUID()},randomUUID()))).rejects.toThrow('Customer Party not available')
    await expect(withActor(db,'billing-unit',tenant,(tx,a)=>createFinancialDocument(tx,a,{type:'bill',unitId:tenantUnit,locationId:null,partyId:customer,bookDate:'2026-02-01',dueDate:'2026-03-01',amount:'100000',commandId:randomUUID()},randomUUID()))).rejects.toThrow('Vendor Party not available')
    const billed=await withActor(db,'billing-unit',tenant,(tx,a)=>createFinancialDocument(tx,a,{type:'bill',unitId:tenantUnit,locationId:null,partyId:vendor,bookDate:'2026-02-01',dueDate:'2026-03-01',amount:'100000',commandId:randomUUID()},randomUUID()))
    // The return value is the HTTP boundary: whole-rupiah quantities must be exact strings.
    expect(billed).toMatchObject({ type:'bill', outstanding:'100000', amount:'100000', status:'open' })
    const listed=await withActor(db,'billing-unit',tenant,(tx,a)=>listFinancialDocuments(tx,a,{unitId:tenantUnit,type:'bill'}))
    expect(listed.find(row=>row.id===billed.id)?.outstanding).toBe('100000')
    const listedPayments=await withActor(db,'billing-unit',tenant,(tx,a)=>listPayments(tx,a,{unitId:tenantUnit,partyId:vendor}))
    expect(listedPayments.every((row:{amount:string;allocated:string})=>typeof row.amount==='string'&&typeof row.allocated==='string')).toBe(true)

    // [SEQ-001] a replayed command returns the same document with a single journal.
    const replay={type:'invoice' as const,unitId:tenantUnit,locationId:null,partyId:customer,bookDate:'2026-02-02',dueDate:'2026-03-02',amount:'50000',commandId:randomUUID()}
    const first=await withActor(db,'billing-unit',tenant,(tx,a)=>createFinancialDocument(tx,a,replay,randomUUID()))
    expect((await withActor(db,'billing-unit',tenant,(tx,a)=>createFinancialDocument(tx,a,replay,randomUUID()))).id).toBe(first.id)
    expect(await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.journals).where(eq(schema.journals.eventId,replay.commandId)))).toHaveLength(1)

    // [BILL-002] aging buckets follow the accepted Phase 3 boundaries.
    for (const [dueDate,amount] of [['2026-06-15','100000'],['2026-05-20','200000'],['2026-04-20','300000'],['2026-03-20','400000'],['2026-01-02','500000']] as const) {
      await invoice(amount,'2026-01-02',dueDate,agingCustomer)
    }
    const aging=await withActor(db,'billing-unit',tenant,(tx,a)=>receivablesAging(tx,a,{asOf:'2026-06-15',type:'invoice',unitId:tenantUnit}))
    const mine=new Map(aging.rows.filter(row=>row.party_id===agingCustomer).map(row=>[String(row.bucket),String(row.outstanding)]))
    expect([mine.get('current'),mine.get('1-30'),mine.get('31-60'),mine.get('61-90'),mine.get('90+')]).toEqual(['100000','200000','300000','400000','500000'])
    expect(Object.keys(aging.buckets)).toEqual(['current','1-30','31-60','61-90','90+'])

    // [PAY-001][PAY-002] partial payment keeps the document open until the balance reaches zero.
    const target=await invoice('100000','2026-02-03','2026-03-03',customer)
    const payment=await withActor(db,'billing-unit',tenant,(tx,a)=>createPayment(tx,a,{direction:'in',unitId:tenantUnit,locationId:null,partyId:customer,cashAccountId:kas,bookDate:'2026-02-05',amount:'70000',commandId:randomUUID()},randomUUID()))
    expect(await withActor(db,'billing-unit',tenant,(tx,a)=>allocatePayment(tx,a,{paymentId:payment.id,documentId:target.id,amount:'40000'},randomUUID()))).toMatchObject({outstanding:'60000',status:'open'})
    await expect(withActor(db,'billing-unit',tenant,(tx,a)=>allocatePayment(tx,a,{paymentId:payment.id,documentId:target.id,amount:'70000'},randomUUID()))).rejects.toThrow()
    const rest=await withActor(db,'billing-unit',tenant,(tx,a)=>createPayment(tx,a,{direction:'in',unitId:tenantUnit,locationId:null,partyId:customer,cashAccountId:kas,bookDate:'2026-02-06',amount:'60000',commandId:randomUUID()},randomUUID()))
    expect(await withActor(db,'billing-unit',tenant,(tx,a)=>allocatePayment(tx,a,{paymentId:rest.id,documentId:target.id,amount:'60000'},randomUUID()))).toMatchObject({outstanding:'0',status:'paid'})
    await expect(withActor(db,'billing-unit',tenant,(tx,a)=>allocatePayment(tx,a,{paymentId:payment.id,documentId:target.id,amount:'1000'},randomUUID()))).rejects.toThrow('tidak dalam status terbuka')
    // RLS hides the other tenant's payment entirely, so the denial surfaces as "unavailable".
    await expect(withActor(db,'user-b',B,(tx,a)=>allocatePayment(tx,a,{paymentId:payment.id,documentId:target.id,amount:'1'},randomUUID()))).rejects.toThrow('Payment unavailable')

    // [PAY-003][AUDIT-001] void keeps actor/reason/reference and is refused once allocated.
    const clean=await invoice('10000','2026-02-07','2026-03-07',customer)
    expect(await withActor(db,'billing-unit',tenant,(tx,a)=>voidFinancialDocument(tx,a,{documentId:clean.id,reason:'Salah input',reference:'MEMO-9'},randomUUID()))).toMatchObject({status:'void',voidedBy:'billing-unit'})
    const trail=await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.financialDocumentEvents).where(eq(schema.financialDocumentEvents.documentId,clean.id)))
    expect(trail.map(row=>row.action)).toEqual(['created','voided'])
    expect(trail.find(row=>row.action==='voided')).toMatchObject({actorId:'billing-unit',reason:'Salah input',reference:'MEMO-9'})
    expect((await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId,clean.id)))).some(row=>row.action==='financial_document.voided')).toBe(true)
    await expect(withActor(db,'billing-unit',tenant,(tx,a)=>voidFinancialDocument(tx,a,{documentId:clean.id,reason:'again'},randomUUID()))).rejects.toThrow('sudah dibatalkan')
    const partially=await invoice('10000','2026-02-08','2026-03-08',customer)
    const small=await withActor(db,'billing-unit',tenant,(tx,a)=>createPayment(tx,a,{direction:'in',unitId:tenantUnit,locationId:null,partyId:customer,cashAccountId:kas,bookDate:'2026-02-08',amount:'5000',commandId:randomUUID()},randomUUID()))
    await withActor(db,'billing-unit',tenant,(tx,a)=>allocatePayment(tx,a,{paymentId:small.id,documentId:partially.id,amount:'5000'},randomUUID()))
    try {
      await withActor(db,'billing-unit',tenant,(tx,a)=>voidFinancialDocument(tx,a,{documentId:partially.id,reason:'attempt'},randomUUID()))
      throw new Error('Void of an allocated document unexpectedly succeeded')
    } catch (error) {
      expect(String((error as {cause?:Error}).cause || error)).toContain('Void is not permitted once allocations exist')
    }

    // [PAY-003][AUDIT-001][ACC-003] payment void keeps actor/reason/reference, reverses the
    // original cash journal, and is refused once the payment carries an allocation.
    const cancellable=await withActor(db,'billing-unit',tenant,(tx,a)=>createPayment(tx,a,{direction:'in',unitId:tenantUnit,locationId:null,partyId:customer,cashAccountId:kas,bookDate:'2026-02-09',amount:'25000',commandId:randomUUID()},randomUUID()))
    const voided=await withActor(db,'billing-unit',tenant,(tx,a)=>voidPayment(tx,a,{paymentId:cancellable.id,reason:'Salah kas',reference:'MEMO-11',eventId:randomUUID(),reversalDate:'2026-02-10'},randomUUID()))
    expect(voided).toMatchObject({status:'void',reason:'Salah kas',reference:'MEMO-11',voidedBy:'billing-unit'})
    const paymentAudit=await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId,cancellable.id)))
    expect(paymentAudit.some(row=>row.action==='payment.voided'&&row.actorId==='billing-unit')).toBe(true)
    const cashJournals=await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.journals).where(eq(schema.journals.eventId,cancellable.commandId)))
    expect(cashJournals).toHaveLength(1)
    const reversal=await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.journals).where(sql`${schema.journals.kind}='reversal' AND ${schema.journals.correctsId}=${cashJournals[0]!.id}`))
    expect(reversal).toHaveLength(1)
    await expect(withActor(db,'billing-unit',tenant,(tx,a)=>voidPayment(tx,a,{paymentId:cancellable.id,reason:'again',eventId:randomUUID(),reversalDate:'2026-02-10'},randomUUID()))).rejects.toThrow('sudah dibatalkan')
    // An allocated payment must not be voided: the allocated history stays meaningful.
    try {
      await withActor(db,'billing-unit',tenant,(tx,a)=>voidPayment(tx,a,{paymentId:small.id,reason:'attempt',eventId:randomUUID(),reversalDate:'2026-02-10'},randomUUID()))
      throw new Error('Void of an allocated payment unexpectedly succeeded')
    } catch (error) {
      expect(String((error as {cause?:Error}).cause || error)).toContain('Void is not permitted once the payment is allocated')
    }
    // A voided payment is closed for further allocation.
    await expect(withActor(db,'billing-unit',tenant,(tx,a)=>allocatePayment(tx,a,{paymentId:cancellable.id,documentId:partially.id,amount:'1'},randomUUID()))).rejects.toThrow('tidak dalam status posted')
    // The guard is not only in the service: direct SQL void without an actor is refused.
    await dbRejection(()=>withActor(db,'billing-unit',tenant,tx=>tx.execute(sql`UPDATE payments SET status='void' WHERE id=${cancellable.id}`)),'Voided payment is immutable')
    await dbRejection(()=>withActor(db,'billing-unit',tenant,tx=>tx.execute(sql`UPDATE payments SET status='void', voided_by=voided_by WHERE id=${small.id}`)),'Void requires an actor')

    // [BILL-001][NFR-SEC-002] outstanding is stored, cannot increase, and cannot move by direct SQL.
    const spare=await withActor(db,'billing-unit',tenant,(tx,a)=>createPayment(tx,a,{direction:'in',unitId:tenantUnit,locationId:null,partyId:customer,cashAccountId:kas,bookDate:'2026-02-09',amount:'100',commandId:randomUUID()},randomUUID()))
    await dbRejection(()=>withActor(db,'billing-unit',tenant,tx=>tx.execute(sql`INSERT INTO payment_allocations(tenant_id,payment_id,document_id,amount,actor_id) VALUES (${tenant},${spare.id},${target.id},1,'billing-unit')`)),'Document is not open')
    // [PAY-003] Neither direction moves by direct SQL: only allocation may lower outstanding and
    // only a refund may restore it.
    await dbRejection(()=>withActor(db,'billing-unit',tenant,tx=>tx.execute(sql`UPDATE financial_documents SET outstanding=outstanding-1, status='open' WHERE id=${partially.id}`)),'Outstanding changes only through payment allocation')
    await dbRejection(()=>withActor(db,'billing-unit',tenant,tx=>tx.execute(sql`UPDATE financial_documents SET outstanding=outstanding+1, status='open' WHERE id=${partially.id}`)),'Outstanding cannot increase')
    await dbRejection(()=>withActor(db,'billing-unit',tenant,tx=>tx.execute(sql`UPDATE financial_documents SET amount=999 WHERE id=${partially.id}`)),'Document financial facts are immutable')
    await dbRejection(()=>withActor(db,'billing-unit',tenant,tx=>tx.execute(sql`UPDATE payments SET amount=999 WHERE id=${payment.id}`)),'Posted payment facts are immutable')
    expect((await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.paymentAllocations).where(eq(schema.paymentAllocations.documentId,target.id)))).map(row=>row.amount.toString()).sort()).toEqual(['40000','60000'])

    // [LOCK-001] a closed period in this tenant rejects new documents like any other posting.
    await withActor(db,'billing-admin',tenant,(tx,a)=>closeAccountingPeriod(tx,a,'2026-07',randomUUID()))
    await expect(invoice('5000','2026-07-10','2026-08-10',customer)).rejects.toThrow('ditutup')

    // [PAY-003][BILL-001][MAP-001..004][AUDIT-001] refund credits cash back to the paying account
    // and restores the document outstanding, bounded by what the payment collected there.
    const refundDoc=await invoice('100000','2026-03-01','2026-04-01',customer)
    const refundEvent=randomUUID()
    const refundPay=await withActor(db,'billing-unit',tenant,(tx,a)=>createPayment(tx,a,{direction:'in',unitId:tenantUnit,locationId:null,partyId:customer,cashAccountId:kas,bookDate:'2026-03-02',amount:'60000',commandId:randomUUID()},randomUUID()))
    await withActor(db,'billing-unit',tenant,(tx,a)=>allocatePayment(tx,a,{paymentId:refundPay.id,documentId:refundDoc.id,amount:'60000'},randomUUID()))
    expect(await withActor(db,'billing-unit',tenant,(tx,a)=>refundPayment(tx,a,{paymentId:refundPay.id,documentId:refundDoc.id,amount:'25000',reason:'Barang dikembalikan',reference:'NOTA-7',eventId:refundEvent,bookDate:'2026-03-05'},randomUUID()))).toMatchObject({amount:'25000',reason:'Barang dikembalikan',reference:'NOTA-7'})
    // Outstanding moves back up by exactly the refunded amount (BILL-001 counts refund effects).
    const afterRefund=await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.financialDocuments).where(eq(schema.financialDocuments.id,refundDoc.id)))
    expect(afterRefund[0]!.outstanding.toString()).toBe('65000')
    expect(afterRefund[0]!.status).toBe('open')
    const refundTrail=await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.financialDocumentEvents).where(eq(schema.financialDocumentEvents.documentId,refundDoc.id)))
    expect(refundTrail.map(row=>row.action)).toEqual(['created','allocated','refunded'])
    expect(refundTrail.find(row=>row.action==='refunded')).toMatchObject({actorId:'billing-unit',reason:'Barang dikembalikan',reference:'NOTA-7'})
    const refundAudit=await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId,refundPay.id)))
    expect(refundAudit.some(row=>row.action==='payment.refunded'&&row.actorId==='billing-unit')).toBe(true)
    // Only the mapped event posts a journal, and it is the mirror of the cash it returns.
    const refundJournal=await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.journals).where(eq(schema.journals.eventId,refundEvent)))
    expect(refundJournal).toHaveLength(1)
    expect(refundJournal[0]).toMatchObject({eventType:'sales_refund',kind:'normal'})
    const refundLines=await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.journalLines).where(eq(schema.journalLines.journalId,refundJournal[0]!.id)))
    expect(refundLines.map(row=>[row.accountId,row.debit.toString(),row.credit.toString()]).sort()).toEqual([[ar,'25000','0'],[kasLedger,'0','25000']].sort())
    // A replay of the same command returns the stored refund instead of refunding twice.
    expect(await withActor(db,'billing-unit',tenant,(tx,a)=>refundPayment(tx,a,{paymentId:refundPay.id,documentId:refundDoc.id,amount:'25000',reason:'Barang dikembalikan',reference:'NOTA-7',eventId:refundEvent,bookDate:'2026-03-05'},randomUUID()))).toMatchObject({amount:'25000'})
    expect(await withActor(db,'billing-unit',tenant,tx=>tx.select().from(schema.paymentRefunds).where(eq(schema.paymentRefunds.paymentId,refundPay.id)))).toHaveLength(1)
    // The refund is bounded by the allocation, not by the payment amount.
    await expect(withActor(db,'billing-unit',tenant,(tx,a)=>refundPayment(tx,a,{paymentId:refundPay.id,documentId:refundDoc.id,amount:'35001',reason:'too much',eventId:randomUUID(),bookDate:'2026-03-05'},randomUUID()))).rejects.toThrow('Refund melebihi nilai yang dialokasikan')
    // A refund needs a real allocation to correct.
    const orphanDoc=await invoice('10000','2026-03-06','2026-04-06',customer)
    await expect(withActor(db,'billing-unit',tenant,(tx,a)=>refundPayment(tx,a,{paymentId:refundPay.id,documentId:orphanDoc.id,amount:'1000',reason:'no allocation',eventId:randomUUID(),bookDate:'2026-03-06'},randomUUID()))).rejects.toThrow('Refund membutuhkan alokasi')
    // RLS still hides the other tenant, and the refund is not a void substitute for allocated cash.
    await expect(withActor(db,'user-b',B,(tx,a)=>refundPayment(tx,a,{paymentId:refundPay.id,documentId:refundDoc.id,amount:'1000',reason:'foreign',eventId:randomUUID(),bookDate:'2026-03-05'},randomUUID()))).rejects.toThrow('Payment unavailable')
    // The guard is not only in the service: a direct insert beyond the allocation is refused.
    await dbRejection(()=>withActor(db,'billing-unit',tenant,tx=>tx.execute(sql`INSERT INTO payment_refunds(tenant_id,payment_id,document_id,amount,command_id,book_date,reason,actor_id) VALUES (${tenant},${refundPay.id},${refundDoc.id},100000,${randomUUID()},'2026-03-06','direct','billing-unit')`)),'Refund exceeds the allocated amount')
    // Refund history is append-only: the runtime role has no UPDATE grant at all, so a corrected
    // refund cannot be rewritten even before the immutability trigger would refuse it.
    await dbRejection(()=>withActor(db,'billing-unit',tenant,tx=>tx.execute(sql`UPDATE payment_refunds SET amount=1 WHERE payment_id=${refundPay.id}`)),'permission denied for table payment_refunds')
    // Reads expose the collected pairs and the refund history the UI needs to bound the next refund.
    expect((await withActor(db,'billing-unit',tenant,(tx,a)=>listAllocations(tx,a,{unitId:tenantUnit,paymentId:refundPay.id})))[0]).toMatchObject({documentId:refundDoc.id,amount:'60000'})
    expect((await withActor(db,'billing-unit',tenant,(tx,a)=>listRefunds(tx,a,{unitId:tenantUnit}))).find(row=>row.paymentId===refundPay.id)).toMatchObject({amount:'25000',paymentNumber:refundPay.number,direction:'in'})
  })

  // ---------------------------------------------------------------------------------------
  // [MBX-9] Procurement source documents: PR -> RFQ -> vendor quotation.
  // These assertions need server-backed PostgreSQL too, because the append-only, line and
  // invited-vendor guards are database triggers the PGlite WASM fallback cannot run faithfully.
  // ---------------------------------------------------------------------------------------
  it.runIf(!!process.env.TEST_DATABASE_URL)('[MBX-9][PROC-001][PROC-002][PROC-003] procurement source flow', async () => {
    const tenant=PT, unit=PU1, otherUnit=PU2
    for (const type of ['purchase_request','rfq','vendor_quotation']) {
      await withActor(db,'procurement-admin',tenant,(tx,a)=>setConfiguration(tx,a,{key:'sequence:'+type,value:{prefix:'PROC-'+type.slice(0,3).toUpperCase(),scope:'unit',reset:'month'},expectedRevision:0},randomUUID()))
    }
    const vendorParty=(code:string,name:string,unitId:string|null)=>withActor(db,'procurement-admin',tenant,(tx,a)=>saveParty(tx,a,undefined,{kind:'organization',name,code,roles:[{role:'vendor',unitId}]},randomUUID()))
    const vendor=(await vendorParty('PROC-V1','Pemasok Satu',null)).id
    const vendor2=(await vendorParty('PROC-V2','Pemasok Dua',null)).id
    const uninvited=(await vendorParty('PROC-V3','Pemasok Tiga',null)).id
    const outsider=(await vendorParty('PROC-V4','Pemasok Empat',null)).id

    // [PROC-001][CFG-001] Item master data is controlled master data: only the admin role writes it.
    const item=(await withActor(db,'procurement-admin',tenant,(tx,a)=>createItem(tx,a,{unitId:null,code:'PROC-ITM-1',name:'Beras',kind:'item',uom:'sak'},randomUUID()))).id
    const service=(await withActor(db,'procurement-admin',tenant,(tx,a)=>createItem(tx,a,{unitId:null,code:'PROC-SVC-1',name:'Angkut',kind:'service',uom:'trip'},randomUUID()))).id
    await expect(withActor(db,'procurement-unit',tenant,(tx,a)=>createItem(tx,a,{unitId:null,code:'PROC-NO',name:'Nope',kind:'item',uom:'pcs'},randomUUID()))).rejects.toThrow()
    expect((await withActor(db,'procurement-unit',tenant,(tx,a)=>listItems(tx,a,{unitId:unit}))).map(row=>row.code).sort()).toEqual(['PROC-ITM-1','PROC-SVC-1'])

    // [PROC-001][ORG-003][AUDIT-001] A PR stores Unit, item/service lines, quantity, justification
    // and status, and is numbered from configured sequencing.
    const pr=(unitId:string,itemId:string)=>withActor(db,'procurement-unit',tenant,(tx,a)=>createPurchaseRequest(tx,a,{unitId,locationId:null,bookDate:'2026-04-01',justification:'Kebutuhan operasional',lines:[{itemId,quantity:'10'}],commandId:randomUUID()},randomUUID()))
    const request=await pr(unit,item)
    expect(request).toMatchObject({status:'draft',unitId:unit,requestedBy:'procurement-unit'})
    expect(request.number).toContain('PROC-PUR')
    expect(request.lines.map(line=>[line.itemId,line.quantity])).toEqual([[item,'10']])
    // The Unit-scoped procurement grant cannot raise a PR outside its assigned Unit.
    await expect(pr(otherUnit,item)).rejects.toThrow('Permission or scope denied')
    // An unknown/inactive item is refused rather than silently accepted as free text.
    await expect(withActor(db,'procurement-unit',tenant,(tx,a)=>createPurchaseRequest(tx,a,{unitId:unit,locationId:null,bookDate:'2026-04-01',justification:'x',lines:[{itemId:randomUUID(),quantity:'1'}],commandId:randomUUID()},randomUUID()))).rejects.toThrow('Item unavailable')
    const list=await withActor(db,'procurement-unit',tenant,(tx,a)=>listPurchaseRequests(tx,a,{unitId:unit,status:'draft'}))
    expect(list.find(row=>row.id===request.id)).toMatchObject({justification:'Kebutuhan operasional'})

    // [SEQ-001] A replayed PR command returns the same document instead of duplicating it.
    const replay={unitId:unit,locationId:null,bookDate:'2026-04-02',justification:'Retry',lines:[{itemId:service,quantity:'2'}],commandId:randomUUID()}
    const createdPr=await withActor(db,'procurement-unit',tenant,(tx,a)=>createPurchaseRequest(tx,a,replay,randomUUID()))
    expect((await withActor(db,'procurement-unit',tenant,(tx,a)=>createPurchaseRequest(tx,a,replay,randomUUID()))).id).toBe(createdPr.id)
    expect(await withActor(db,'procurement-unit',tenant,tx=>tx.select().from(schema.purchaseRequests).where(eq(schema.purchaseRequests.commandId,replay.commandId)))).toHaveLength(1)

    // [PROC-001] Submitting is the only status move this slice owns, and it records the submitter.
    const submitted=await withActor(db,'procurement-unit',tenant,(tx,a)=>submitPurchaseRequest(tx,a,{purchaseRequestId:request.id},randomUUID()))
    expect(submitted).toMatchObject({status:'submitted',submittedBy:'procurement-unit'})
    await expect(withActor(db,'procurement-unit',tenant,(tx,a)=>submitPurchaseRequest(tx,a,{purchaseRequestId:request.id},randomUUID()))).rejects.toThrow('Hanya draft')

    // [PROC-002] An RFQ is addressed to several Vendors; an RFQ needs a submitted PR.
    await expect(withActor(db,'procurement-unit',tenant,(tx,a)=>createRfq(tx,a,{purchaseRequestId:createdPr.id,bookDate:'2026-04-03',vendorIds:[vendor],note:null,commandId:randomUUID()},randomUUID()))).rejects.toThrow('Purchase Request berstatus submitted')
    const rfq=await withActor(db,'procurement-unit',tenant,(tx,a)=>createRfq(tx,a,{purchaseRequestId:request.id,bookDate:'2026-04-03',vendorIds:[vendor,vendor2],note:'Mohon penawaran',commandId:randomUUID()},randomUUID()))
    expect(rfq.vendorIds.sort()).toEqual([vendor,vendor2].sort())
    expect(rfq.number).toContain('PROC-RFQ')
    // A non-vendor Party cannot be invited to quote.
    await expect(withActor(db,'procurement-unit',tenant,(tx,a)=>createRfq(tx,a,{purchaseRequestId:request.id,bookDate:'2026-04-04',vendorIds:[randomUUID()],note:null,commandId:randomUUID()},randomUUID()))).rejects.toThrow('Vendor Party not available')
    // Vendors can still be added, and adding one twice is idempotent.
    expect((await withActor(db,'procurement-unit',tenant,(tx,a)=>addRfqVendors(tx,a,{rfqId:rfq.id,vendorIds:[uninvited,vendor]},randomUUID()))).vendorIds.sort()).toEqual([vendor,vendor2,uninvited].sort())
    expect((await withActor(db,'procurement-unit',tenant,(tx,a)=>listRfqs(tx,a,{unitId:unit}))).find(row=>row.id===rfq.id)?.vendorIds).toHaveLength(3)

    // [PROC-003][PROC-004] A quotation stores per-Vendor, per-item price and commercial terms.
    const quote=(partyId:string,unitPrice:string,extra:Record<string,unknown>={})=>withActor(db,'procurement-unit',tenant,(tx,a)=>createQuotation(tx,a,{rfqId:rfq.id,partyId,bookDate:'2026-04-05',validUntil:'2026-04-30',paymentTerm:'Net 30',deliveryDays:7,lines:[{itemId:item,quantity:'10',unitPrice}],supersedesId:null,...extra,commandId:randomUUID()},randomUUID()))
    const first=await quote(vendor,'7500')
    expect(first).toMatchObject({revision:1,paymentTerm:'Net 30',deliveryDays:7,partyId:vendor})
    expect(first.lines.map(line=>[line.itemId,line.quantity,line.unitPrice])).toEqual([[item,'10','7500']])
    const second=await quote(vendor2,'7000')
    // The same RFQ now holds quotations from more than one Vendor.
    const quotations=await withActor(db,'procurement-unit',tenant,(tx,a)=>listQuotations(tx,a,{rfqId:rfq.id,unitId:unit}))
    expect(quotations.map(row=>row.partyId).sort()).toEqual([vendor,vendor2].sort())
    expect(quotations.find(row=>row.id===first.id)?.total).toBe('75000')
    // A Vendor that was never invited cannot quote this RFQ.
    await expect(quote(outsider,'1')).rejects.toThrow('belum diundang')
    // [AUDIT-001] A correction is a new revision that supersedes the prior one; history is kept.
    const revised=await quote(vendor,'7200',{supersedesId:first.id})
    expect(revised).toMatchObject({revision:2,supersedesId:first.id})
    await expect(quote(vendor2,'1',{supersedesId:first.id})).rejects.toThrow('vendor yang sama')
    const audit=await withActor(db,'procurement-unit',tenant,tx=>tx.select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId,revised.id)))
    expect(audit.some(row=>row.action==='vendor_quotation.created'&&row.actorId==='procurement-unit')).toBe(true)

    // [NFR-SEC-002] Tenant isolation: another BUMDes sees none of these procurement records,
    // which is why a foreign request surfaces as "unavailable" instead of leaking existence.
    expect(rowsOf(await withActor(db,'user-b',B,tx=>tx.execute(sql`SELECT id FROM purchase_requests WHERE id=${request.id}`)))).toEqual([])
    expect(rowsOf(await withActor(db,'user-b',B,tx=>tx.execute(sql`SELECT id FROM vendor_quotations WHERE id=${first.id}`)))).toEqual([])
    expect(rowsOf(await withActor(db,'user-b',B,tx=>tx.execute(sql`SELECT id FROM items WHERE id=${item}`)))).toEqual([])
    await expect(withActor(db,'user-b',B,(tx,a)=>submitPurchaseRequest(tx,a,{purchaseRequestId:request.id},randomUUID()))).rejects.toThrow('unavailable')
    await dbRejection(()=>withActor(db,'user-b',B,tx=>tx.execute(sql`INSERT INTO items(tenant_id,code,name,kind,uom,actor_id) VALUES (${tenant},'PROC-X','X','item','pcs',${'user-b'})`)),'row-level security')

    // The guards are not only in the service. Append-only tables carry no UPDATE grant at all, so a
    // stored quotation or item cannot be rewritten even before the immutability trigger would fire.
    await dbRejection(()=>withActor(db,'procurement-unit',tenant,tx=>tx.execute(sql`UPDATE vendor_quotations SET payment_term='Net 90' WHERE id=${first.id}`)),'permission denied for table vendor_quotations')
    await dbRejection(()=>withActor(db,'procurement-unit',tenant,tx=>tx.execute(sql`UPDATE items SET name='Berubah' WHERE id=${item}`)),'permission denied for table items')
    // A submitted Purchase Request cannot be re-opened or edited through direct SQL either.
    await dbRejection(()=>withActor(db,'procurement-unit',tenant,tx=>tx.execute(sql`UPDATE purchase_requests SET status='draft', submitted_by=NULL, submitted_at=NULL WHERE id=${request.id}`)),'immutable')
    await dbRejection(()=>withActor(db,'procurement-unit',tenant,tx=>tx.execute(sql`UPDATE purchase_requests SET justification='Ubah diam-diam' WHERE id=${request.id}`)),'facts are immutable')
    await dbRejection(()=>withActor(db,'procurement-unit',tenant,tx=>tx.execute(sql`UPDATE purchase_requests SET justification='Ubah draft' WHERE id=${createdPr.id}`)),'facts are immutable')
    await dbRejection(()=>withActor(db,'procurement-unit',tenant,tx=>tx.execute(sql`INSERT INTO vendor_quotations(tenant_id,number,command_id,rfq_id,party_id,unit_id,book_date,revision,actor_id) VALUES (${tenant},'FORGED',${randomUUID()},${rfq.id},${outsider},${unit},'2026-04-06',1,'procurement-unit')`)),'not invited')
    await dbRejection(()=>withActor(db,'procurement-unit',tenant,tx=>tx.execute(sql`INSERT INTO purchase_request_lines(tenant_id,purchase_request_id,line_no,item_id,quantity) VALUES (${tenant},${request.id},99,${item},1)`)),'must be inserted with their new document')
  })

  // ---------------------------------------------------------------------------------------
  // [MBX-10] Vendor comparison over the quotations MBX-9 already stores. There is no table, no
  // migration and no write path, so there is no audit trail to assert. The guarantees are the
  // read-model ones PROC-004 names: effective revision per Vendor, side-by-side item price,
  // total, delivery and payment terms, and history that is only shown when evidence exists.
  // ---------------------------------------------------------------------------------------
  it.runIf(!!process.env.TEST_DATABASE_URL)('[MBX-10][PROC-004] vendor comparison uses the effective revision and only evidenced history', async () => {
    const tenant=PT, unit=PU1
    // Sequences are tenant-wide configuration, so they are only created when absent: the MBX-9 test
    // in this same file already owns them, and the revision guard rejects a blind second write.
    for (const type of ['purchase_request','rfq','vendor_quotation']) {
      const key='sequence:'+type
      if (!await withActor(db,'procurement-admin',tenant,(tx,a)=>readConfiguration(tx,a.tenantId,key)))
        await withActor(db,'procurement-admin',tenant,(tx,a)=>setConfiguration(tx,a,{key,value:{prefix:'CMP-'+type.slice(0,3).toUpperCase(),scope:'unit',reset:'month'},expectedRevision:0},randomUUID()))
    }
    const vendorParty=(code:string,name:string)=>withActor(db,'procurement-admin',tenant,(tx,a)=>saveParty(tx,a,undefined,{kind:'organization',name,code,roles:[{role:'vendor',unitId:null}]},randomUUID()))
    const vendor1=(await vendorParty('CMP-V1','Pemasok Satu')).id
    const vendor2=(await vendorParty('CMP-V2','Pemasok Dua')).id
    const vendor3=(await vendorParty('CMP-V3','Pemasok Tiga')).id
    const item=(await withActor(db,'procurement-admin',tenant,(tx,a)=>createItem(tx,a,{unitId:null,code:'CMP-ITM-1',name:'Gula',kind:'item',uom:'sak'},randomUUID()))).id

    // Raising a submitted PR with an RFQ to the given vendors is the shared setup for both rounds.
    const openRfq=async(vendorIds:string[],bookDate:string)=>{
      const request=await withActor(db,'procurement-unit',tenant,(tx,a)=>createPurchaseRequest(tx,a,{unitId:unit,locationId:null,bookDate,justification:'Uji perbandingan',lines:[{itemId:item,quantity:'10'}],commandId:randomUUID()},randomUUID()))
      await withActor(db,'procurement-unit',tenant,(tx,a)=>submitPurchaseRequest(tx,a,{purchaseRequestId:request.id},randomUUID()))
      return withActor(db,'procurement-unit',tenant,(tx,a)=>createRfq(tx,a,{purchaseRequestId:request.id,bookDate,vendorIds,note:null,commandId:randomUUID()},randomUUID()))
    }
    const quote=(rfqId:string,partyId:string,unitPrice:string,bookDate:string,extra:Record<string,unknown>={})=>withActor(db,'procurement-unit',tenant,(tx,a)=>createQuotation(tx,a,{rfqId,partyId,bookDate,validUntil:null,paymentTerm:'Net 30',deliveryDays:5,lines:[{itemId:item,quantity:'10',unitPrice}],supersedesId:null,...extra,commandId:randomUUID()},randomUUID()))

    // Round one establishes the evidence that round two is compared against.
    const firstRfq=await openRfq([vendor1,vendor2],'2026-04-01')
    await quote(firstRfq.id,vendor1,'7000','2026-04-10')
    await quote(firstRfq.id,vendor2,'7200','2026-04-10')

    const secondRfq=await openRfq([vendor1,vendor2,vendor3],'2026-05-01')
    await quote(secondRfq.id,vendor1,'7700','2026-05-05')
    const superseded=await quote(secondRfq.id,vendor2,'7000','2026-05-05')
    // The correction must replace the quote it names, so vendor2 ends on 6840 with revision 2.
    await quote(secondRfq.id,vendor2,'6840','2026-05-05',{supersedesId:superseded.id})

    // [IAM-002] A Unit-scoped reader compares without passing a Unit: scope is resolved from the RFQ.
    const comparison=await withActor(db,'procurement-unit',tenant,(tx,a)=>compareQuotations(tx,a,{rfqId:secondRfq.id}))
    expect(comparison.rfq).toMatchObject({id:secondRfq.id,number:secondRfq.number,unitId:unit})
    expect(comparison.purchaseRequest?.status).toBe('submitted')

    // [PROC-002] An invited Vendor that never quoted still appears, with nothing to show for a price.
    const absent=comparison.vendors.find(vendor=>vendor.partyId===vendor3)
    expect(absent).toMatchObject({invited:true,quotation:null,total:null,itemsPriced:0,itemsMissing:1})
    expect(absent?.offers[0]).toMatchObject({unitPrice:null,historicalUnitPrice:null,priceDelta:null,priceDeltaPct:null})

    // [PROC-003] Only the effective revision is compared, so the superseded 7000 cannot win.
    const second=comparison.vendors.find(vendor=>vendor.partyId===vendor2)
    expect(second).toMatchObject({invited:true,total:'68400',itemsPriced:1,itemsMissing:0})
    expect(second?.quotation).toMatchObject({revision:2,revisionCount:2,paymentTerm:'Net 30',deliveryDays:5})
    expect(second?.offers[0]).toMatchObject({unitPrice:'6840',amount:'68400'})

    // [PROC-004] Historical price comes from the same Vendor on a different RFQ, with a real delta.
    expect(second?.offers[0]).toMatchObject({historicalUnitPrice:'7200',historicalBookDate:'2026-04-10',priceDelta:'-360',priceDeltaPct:-5})
    const first=comparison.vendors.find(vendor=>vendor.partyId===vendor1)
    expect(first?.offers[0]).toMatchObject({unitPrice:'7700',historicalUnitPrice:'7000',priceDelta:'700',priceDeltaPct:10})

    // [PROC-004] Item-level cheapest and total-level lowest are both stated, ties included.
    expect(comparison.items).toHaveLength(1)
    expect(comparison.items[0]).toMatchObject({code:'CMP-ITM-1',uom:'sak',cheapestUnitPrice:'6840',cheapestPartyIds:[vendor2]})
    expect(comparison.summary).toMatchObject({vendors:3,quoted:2,revisions:1,lowestTotal:'68400',lowestTotalPartyIds:[vendor2],hasHistoricalPrices:true})

    // [PROC-004] With no earlier RFQ there is no evidence, so history is absent rather than invented.
    // The anchor is stated so a reader can see history only ever comes from before this comparison.
    const noHistory=await withActor(db,'procurement-unit',tenant,(tx,a)=>compareQuotations(tx,a,{rfqId:firstRfq.id}))
    expect(noHistory.summary).toMatchObject({hasHistoricalPrices:false,historicalAnchorDate:'2026-04-01'})
    expect(noHistory.vendors.find(vendor=>vendor.partyId===vendor1)?.offers[0]).toMatchObject({unitPrice:'7000',historicalUnitPrice:null,historicalQuotationNumber:null,historicalBookDate:null,priceDelta:null,priceDeltaPct:null})

    // Equal prices mark every tied Vendor as cheapest instead of picking one arbitrarily. Vendor 1
    // reaches the tie through a revision, which also proves the highest revision is the effective one.
    const vendor1First=comparison.vendors.find(vendor=>vendor.partyId===vendor1)!.quotation!
    await quote(secondRfq.id,vendor1,'6840','2026-05-06',{supersedesId:vendor1First.id})
    const tied=await withActor(db,'procurement-unit',tenant,(tx,a)=>compareQuotations(tx,a,{rfqId:secondRfq.id}))
    expect(tied.items[0]?.cheapestUnitPrice).toBe('6840')
    expect(tied.items[0]?.cheapestPartyIds.sort()).toEqual([vendor1,vendor2].sort())
    expect(tied.summary.lowestTotalPartyIds.sort()).toEqual([vendor1,vendor2].sort())

    // [PROC-004] A quotation may carry two lines for one item; the schema only forbids a repeated
    // line number. The cell must then report a mixed rate instead of one of the two prices, while the
    // total still sums every line.
    const mixed=await withActor(db,'procurement-unit',tenant,(tx,a)=>createQuotation(tx,a,{rfqId:secondRfq.id,partyId:vendor3,bookDate:'2026-05-07',validUntil:null,
      paymentTerm:'Net 14',deliveryDays:3,supersedesId:null,commandId:randomUUID(),
      lines:[{itemId:item,quantity:'2',unitPrice:'5000'},{itemId:item,quantity:'3',unitPrice:'6000'}]},randomUUID()))
    const mixedView=await withActor(db,'procurement-unit',tenant,(tx,a)=>compareQuotations(tx,a,{rfqId:secondRfq.id}))
    const mixedVendor=mixedView.vendors.find(vendor=>vendor.partyId===vendor3)
    expect(mixedVendor).toMatchObject({itemsPriced:0,itemsMissing:0,itemsMixed:1,total:'28000'})
    expect(mixedVendor?.offers[0]).toMatchObject({unitPrice:null,mixedRate:true,quantity:'5',amount:'28000',priceDelta:null,priceDeltaPct:null})
    // A mixed rate cannot be named cheapest, so vendor 2 keeps the item marker on its own.
    expect(mixedView.items[0]).toMatchObject({cheapestUnitPrice:'6840',cheapestPartyIds:[vendor1,vendor2].sort()})

    // [NFR-SEC-002] Another BUMDes cannot compare this RFQ, and a foreign RFQ is simply unavailable.
    await expect(withActor(db,'user-b',B,(tx,a)=>compareQuotations(tx,a,{rfqId:secondRfq.id}))).rejects.toThrow('RFQ unavailable')
    // A tenant-scoped reader needs no Unit parameter, which is why the admin path is exercised too.
    expect((await withActor(db,'procurement-admin',tenant,(tx,a)=>compareQuotations(tx,a,{rfqId:secondRfq.id}))).summary.vendors).toBe(3)

    // Every amount leaves the module as an exact string. A raw bigint cannot cross the JSON boundary,
    // so serializing the response is asserted here rather than discovered as a 500 in production.
    expect(()=>JSON.stringify(tied)).not.toThrow()
    expect(JSON.parse(JSON.stringify(tied))).toMatchObject({summary:{lowestTotal:'68400'},items:[{cheapestUnitPrice:'6840'}]})
    const serialized=JSON.stringify(tied)
    expect(serialized).not.toContain('n,')
    expect(serialized).not.toMatch(/:\s*\d+n/)
  })

})
