import { randomUUID } from 'node:crypto'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { sql } from 'drizzle-orm'
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
import { createUser, listUsers, resendInvitation, updateGrants, setAccountActive } from '../server/core/iam/users'
import { activateAccount } from '../server/core/iam/activation'
import { updateOrganization } from '../server/core/organization/settings'

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
const rowsOf = (result: unknown): unknown[] => Array.isArray(result) ? result : (result as { rows: unknown[] }).rows
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
    auth = createAuth(db, 'test-only-secret-not-a-production-secret-123456', 'http://localhost:3000')
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
})
