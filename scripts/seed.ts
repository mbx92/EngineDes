import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from '../server/database/schema'
import { seedDummy } from '../server/core/governance/demo'
// [MBX-5] Never seed a remote or production database. No passwords/default login.
if (process.env.NODE_ENV === 'production') throw new Error('Dummy seed is development-only')
const url = process.env.DATABASE_URL, maintenanceUrl = process.env.MIGRATION_DATABASE_URL
if (!url || !maintenanceUrl) throw new Error('DATABASE_URL and MIGRATION_DATABASE_URL required')
for (const endpoint of [url,maintenanceUrl]) {
  const u = new URL(endpoint)
  if (!['localhost','127.0.0.1','[::1]'].includes(u.hostname) || u.pathname !== '/enginedes') throw new Error('Seed supports local enginedes database only')
}
const maintenance=postgres(maintenanceUrl,{max:1}),runtime=postgres(url,{max:1})
try {
  const [role]=await runtime`SELECT rolsuper,rolbypassrls,EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user) AS owns_tables FROM pg_roles WHERE rolname=current_user`
  if(!role || role.rolsuper || role.rolbypassrls || role.owns_tables)throw new Error('Restricted runtime credentials required')
  const admins=await maintenance`SELECT m.user_id,m.tenant_id FROM memberships m JOIN role_grants g ON g.membership_id=m.id AND g.tenant_id=m.tenant_id WHERE m.active AND NOT m.pending AND g.role='admin' AND g.scope='tenant' ORDER BY m.user_id`
  const tenant=process.env.SEED_TENANT_ID
  const candidates=tenant ? admins.filter(a=>a.tenant_id===tenant) : admins
  if(!candidates.length || new Set(candidates.map(a=>a.tenant_id)).size !== 1)throw new Error('Select exactly one local tenant with SEED_TENANT_ID')
  console.log('Dummy seed:',await seedDummy(drizzle(runtime,{schema}),candidates[0]!.user_id,candidates[0]!.tenant_id))
}finally{await maintenance.end();await runtime.end()}
