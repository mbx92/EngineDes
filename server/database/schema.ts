import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

// MBX-5: identity persistence is platform-scoped; operational data uses ADR-009 RLS.
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updated = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
export const user = pgTable('auth_user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false), image: text('image'),
  createdAt: created(), updatedAt: updated(),
})
export const session = pgTable('auth_session', {
  id: text('id').primaryKey(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(), createdAt: created(), updatedAt: updated(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
})
export const account = pgTable('auth_account', {
  id: text('id').primaryKey(), accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'), refreshToken: text('refresh_token'), idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'), password: text('password'), createdAt: created(), updatedAt: updated(),
}, t => [unique().on(t.providerId, t.accountId)])
export const verification = pgTable('auth_verification', {
  id: text('id').primaryKey(), identifier: text('identifier').notNull(), value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), createdAt: created(), updatedAt: updated(),
})
export const roleNames = ['admin', 'director', 'finance', 'unit_manager', 'operator', 'supervisor'] as const
export const roleEnum = pgEnum('role_name', roleNames)
export const scopeEnum = pgEnum('access_scope', ['tenant', 'unit'])
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(), name: text('name').notNull(), active: boolean('active').notNull().default(true), createdAt: created(),
})
// ORG-001: a Unit belongs to a BUMDes; it is not a separate ledger.
export const units = pgTable('units', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(), code: text('code').notNull(), active: boolean('active').notNull().default(true), createdAt: created(),
}, t => [unique().on(t.tenantId, t.id), unique().on(t.tenantId, t.code)])
// One login identity belongs to one BUMDes, with multiple role/Unit grants (ORG-002).
export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: text('user_id').notNull().unique().references(() => user.id), active: boolean('active').notNull().default(true),
}, t => [unique().on(t.tenantId, t.id)])
export const roleGrants = pgTable('role_grants', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  membershipId: uuid('membership_id').notNull(), role: roleEnum('role').notNull(), scope: scopeEnum('scope').notNull(), unitId: uuid('unit_id'),
}, t => [
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  foreignKey({ columns: [t.tenantId, t.unitId], foreignColumns: [units.tenantId, units.id] }),
  check('scope_matches_unit', sql`(${t.scope} = 'tenant' AND ${t.unitId} IS NULL) OR (${t.scope} = 'unit' AND ${t.unitId} IS NOT NULL)`),
])
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  actorId: text('actor_id').notNull().references(() => user.id), action: text('action').notNull(),
  entityId: text('entity_id').notNull(), before: jsonb('before'), after: jsonb('after'), requestId: uuid('request_id').notNull(), createdAt: created(),
})
