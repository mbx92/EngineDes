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
})
