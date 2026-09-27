import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'
import { sql } from 'drizzle-orm'

let database: ReturnType<typeof drizzle<typeof schema>> | undefined
export function getDatabase() {
  if (!database) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required')
    database = drizzle(postgres(url, { max: 10 }), { schema })
  }
  return database
}
export type Database = ReturnType<typeof getDatabase>
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

let roleCheck: Promise<void> | undefined
export function verifyRuntimeRole(): Promise<void> {
  roleCheck ??= (async () => {
    const result = await getDatabase().execute(sql`SELECT r.rolsuper, r.rolbypassrls,
      EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owns_tables
      FROM pg_roles r WHERE r.rolname = current_user`)
    const row = result[0]
    if (!row || row.rolsuper || row.rolbypassrls || row.owns_tables) throw new Error('Runtime database role must not own tables, be superuser, or bypass RLS')
  })().catch(error => { roleCheck = undefined; throw error })
  return roleCheck
}
