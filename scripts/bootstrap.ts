import { randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { user, account, tenants, memberships, roleGrants, auditEvents } from '../server/database/schema'

// Restricted operator CLI only; no HTTP endpoint or production default credentials.
const config = z.object({
  MIGRATION_DATABASE_URL: z.string().min(1), BOOTSTRAP_EMAIL: z.email(),
  BOOTSTRAP_PASSWORD: z.string().min(12).max(128), BOOTSTRAP_NAME: z.string().trim().min(1),
  BOOTSTRAP_BUMDES: z.string().trim().min(1),
}).parse(process.env)
const connection = postgres(config.MIGRATION_DATABASE_URL, { max: 1 })
try {
  const [role] = await connection`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
  if (!role?.rolsuper && !role?.rolbypassrls) throw new Error('Bootstrap requires an explicitly privileged maintenance role; never use runtime credentials')
  const password = await hashPassword(config.BOOTSTRAP_PASSWORD)
  await drizzle(connection).transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(503006)`)
    const existing = await tx.select({ id: tenants.id }).from(tenants).limit(1)
    if (existing.length) throw new Error('Bootstrap only supports an empty installation; do not reset existing accounts')
    const actorId = randomUUID(), tenantId = randomUUID(), membershipId = randomUUID()
    await tx.insert(user).values({ id: actorId, name: config.BOOTSTRAP_NAME, email: config.BOOTSTRAP_EMAIL.toLowerCase(), emailVerified: false })
    await tx.insert(account).values({ id: randomUUID(), accountId: actorId, providerId: 'credential', userId: actorId, password })
    await tx.insert(tenants).values({ id: tenantId, name: config.BOOTSTRAP_BUMDES })
    await tx.insert(memberships).values({ id: membershipId, userId: actorId, tenantId })
    await tx.insert(roleGrants).values({ tenantId, membershipId, role: 'admin', scope: 'tenant' })
    await tx.insert(auditEvents).values({ tenantId, actorId, action: 'installation.bootstrapped', entityId: tenantId,
      requestId: randomUUID(), after: { initialAdminCreated: true } })
  })
  console.info('Initial BUMDes and admin created. Remove bootstrap credentials from the environment.')
} finally { await connection.end() }
