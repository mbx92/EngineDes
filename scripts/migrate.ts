import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const url = process.env.MIGRATION_DATABASE_URL
if (!url) throw new Error('MIGRATION_DATABASE_URL is required; never migrate with runtime credentials')
const connection = postgres(url, { max: 1 })
try {
  // One release runner, serialized across competing invocations. No automatic runtime migrations.
  await connection`SELECT pg_advisory_lock(503005)`
  await migrate(drizzle(connection), { migrationsFolder: './migrations' })
  console.info('EngineDes migrations applied')
} finally {
  await connection`SELECT pg_advisory_unlock(503005)`
  await connection.end()
}
