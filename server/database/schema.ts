import { sql } from 'drizzle-orm'
import { bigint, boolean, check, date, foreignKey, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

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
  pending: boolean('pending').notNull().default(false),
}, t => [unique().on(t.tenantId, t.id)])
export const roleGrants = pgTable('role_grants', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  membershipId: uuid('membership_id').notNull(), role: roleEnum('role').notNull(), scope: scopeEnum('scope').notNull(), unitId: uuid('unit_id'), locationId: uuid('location_id'),
}, t => [
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  foreignKey({ columns: [t.tenantId, t.unitId], foreignColumns: [units.tenantId, units.id] }),
  foreignKey({ columns: [t.tenantId, t.unitId, t.locationId], foreignColumns: [locations.tenantId, locations.unitId, locations.id] }),
  check('scope_matches_unit', sql`(${t.scope} = 'tenant' AND ${t.unitId} IS NULL) OR (${t.scope} = 'unit' AND ${t.unitId} IS NOT NULL)`),
  check('location_requires_unit', sql`${t.locationId} IS NULL OR ${t.unitId} IS NOT NULL`),
])
// MBX-5 / ORG-002, PARTY-001/002, CFG-001, SEQ-001: tenant-aware master data.
export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), unitId: uuid('unit_id').notNull(),
  name: text('name').notNull(), code: text('code').notNull(), active: boolean('active').notNull().default(true), createdAt: created(),
}, t => [foreignKey({ columns: [t.tenantId, t.unitId], foreignColumns: [units.tenantId, units.id] }),
  unique().on(t.tenantId, t.unitId, t.id), unique().on(t.tenantId, t.unitId, t.code)])
export const parties = pgTable('parties', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  kind: text('kind').notNull(), name: text('name').notNull(), code: text('code').notNull(), active: boolean('active').notNull().default(true), createdAt: created(),
}, t => [unique().on(t.tenantId, t.id), unique().on(t.tenantId, t.code), check('party_kind', sql`${t.kind} IN ('person','organization')`)])
export const partyRoles = pgTable('party_roles', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), partyId: uuid('party_id').notNull(),
  role: text('role').notNull(), unitId: uuid('unit_id'),
}, t => [foreignKey({ columns: [t.tenantId, t.partyId], foreignColumns: [parties.tenantId, parties.id] }),
  foreignKey({ columns: [t.tenantId, t.unitId], foreignColumns: [units.tenantId, units.id] }),
  check('party_role', sql`${t.role} IN ('customer','vendor','employee')`),
  uniqueIndex('party_roles_context').on(t.tenantId,t.partyId,t.role,sql`COALESCE(${t.unitId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
])
export const configurations = pgTable('configurations', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  key: text('key').notNull(), revision: integer('revision').notNull(), value: jsonb('value').notNull(), updatedAt: updated(),
}, t => [unique().on(t.tenantId, t.key), check('configuration_revision', sql`${t.revision} > 0`)])
export const configurationRevisions = pgTable('configuration_revisions', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  key: text('key').notNull(), revision: integer('revision').notNull(), value: jsonb('value').notNull(),
  actorId: text('actor_id').notNull().references(() => user.id), createdAt: created(),
}, t => [unique().on(t.tenantId, t.key, t.revision)])
export const sequenceCounters = pgTable('sequence_counters', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  key: text('key').notNull(), value: integer('value').notNull(),
}, t => [unique().on(t.tenantId, t.key), check('sequence_positive', sql`${t.value} > 0`)])
export const documentNumbers = pgTable('document_numbers', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: text('type').notNull(), commandId: uuid('command_id').notNull(), fingerprint: text('fingerprint').notNull(),
  number: text('number').notNull(), configurationRevision: integer('configuration_revision').notNull(),
  unitId: uuid('unit_id'), createdAt: created(),
}, t => [unique().on(t.tenantId, t.type, t.commandId), unique().on(t.tenantId, t.number),
  foreignKey({ columns: [t.tenantId, t.unitId], foreignColumns: [units.tenantId, units.id] })])
// [MBX-6][ACC-001..005][LOCK-001] One tenant ledger; Units are line dimensions.
export const ledgerAccounts = pgTable('ledger_accounts', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  code: text('code').notNull(), name: text('name').notNull(), kind: text('kind').notNull(), active: boolean('active').notNull().default(true), createdAt: created(),
}, t => [unique().on(t.tenantId,t.id), unique().on(t.tenantId,t.code), check('ledger_account_kind',sql`${t.kind} IN ('asset','liability','equity','revenue','expense')`)])
export const accountingPeriods = pgTable('accounting_periods', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  month: text('month').notNull(), closedAt: timestamp('closed_at',{withTimezone:true}).notNull().defaultNow(),
  closedBy: text('closed_by').notNull().references(() => user.id),
}, t => [unique().on(t.tenantId,t.month), check('accounting_period_month',sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)])
export const journals = pgTable('journals', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  eventId: uuid('event_id').notNull(), fingerprint: text('fingerprint').notNull(),
  eventType: text('event_type').notNull(), schemaVersion: integer('schema_version').notNull(), mappingRevision: integer('mapping_revision'),
  bookDate: date('book_date',{mode:'string'}).notNull(), kind: text('kind').notNull(),
  correctsId: uuid('corrects_id'), actorId: text('actor_id').notNull().references(() => user.id), createdAt: created(),
}, t => [unique().on(t.tenantId,t.id), unique().on(t.tenantId,t.eventId),
  foreignKey({columns:[t.tenantId,t.correctsId],foreignColumns:[t.tenantId,t.id]}),
  check('journal_kind',sql`${t.kind} IN ('normal','reversal','adjustment')`),
  check('journal_version',sql`${t.schemaVersion} > 0`)])
export const journalLines = pgTable('journal_lines', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), journalId: uuid('journal_id').notNull(),
  lineNo: integer('line_no').notNull(), accountId: uuid('account_id').notNull(), unitId: uuid('unit_id').notNull(),
  debit: bigint('debit',{mode:'bigint'}).notNull(), credit: bigint('credit',{mode:'bigint'}).notNull(),
}, t => [unique().on(t.tenantId,t.journalId,t.lineNo),
  foreignKey({columns:[t.tenantId,t.journalId],foreignColumns:[journals.tenantId,journals.id]}),
  foreignKey({columns:[t.tenantId,t.accountId],foreignColumns:[ledgerAccounts.tenantId,ledgerAccounts.id]}),
  foreignKey({columns:[t.tenantId,t.unitId],foreignColumns:[units.tenantId,units.id]}),
  check('journal_line_side',sql`(${t.debit} > 0 AND ${t.credit} = 0) OR (${t.credit} > 0 AND ${t.debit} = 0)`),
  check('journal_line_no',sql`${t.lineNo} > 0`)])
// [MBX-7][MAP-001..004] Revisioned, tenant-owned mapping; historical rule is retained.
export const accountingMappings = pgTable('accounting_mappings', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  eventType: text('event_type').notNull(), schemaVersion: integer('schema_version').notNull(), revision: integer('revision').notNull(),
  rules: jsonb('rules').notNull(), active: boolean('active').notNull().default(true), updatedAt: updated(),
}, t => [unique().on(t.tenantId,t.eventType,t.schemaVersion),check('mapping_version',sql`${t.schemaVersion} > 0 AND ${t.revision} > 0`)])
export const accountingMappingRevisions = pgTable('accounting_mapping_revisions', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  eventType: text('event_type').notNull(), schemaVersion: integer('schema_version').notNull(), revision: integer('revision').notNull(),
  rules: jsonb('rules').notNull(), actorId: text('actor_id').notNull().references(() => user.id), createdAt: created(),
}, t => [unique().on(t.tenantId,t.eventType,t.schemaVersion,t.revision)])
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  actorId: text('actor_id').notNull().references(() => user.id), action: text('action').notNull(),
  entityId: text('entity_id').notNull(), before: jsonb('before'), after: jsonb('after'), requestId: uuid('request_id').notNull(), createdAt: created(),
})
// [MBX-8][CASH-001] A cash/bank account is a tenant-owned operational entity bound to
// exactly one existing ledger account. It is not a second ledger and holds no debit/credit rule.
export const cashAccounts = pgTable('cash_accounts', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  unitId: uuid('unit_id').notNull(), code: text('code').notNull(), name: text('name').notNull(),
  kind: text('kind').notNull(), ledgerAccountId: uuid('ledger_account_id').notNull(),
  active: boolean('active').notNull().default(true), createdAt: created(),
}, t => [unique().on(t.tenantId,t.id), unique().on(t.tenantId,t.unitId,t.code),
  foreignKey({columns:[t.tenantId,t.unitId],foreignColumns:[units.tenantId,units.id]}),
  foreignKey({columns:[t.tenantId,t.ledgerAccountId],foreignColumns:[ledgerAccounts.tenantId,ledgerAccounts.id]}),
  check('cash_account_kind',sql`${t.kind} IN ('cash','bank')`)])
// [MBX-8][BILL-001..003] AR/AP document. Outstanding is stored, never derived at read time,
// so concurrent allocation cannot silently oversell the same balance.
export const financialDocuments = pgTable('financial_documents', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  type: text('type').notNull(), number: text('number').notNull(), commandId: uuid('command_id').notNull(),
  unitId: uuid('unit_id').notNull(), locationId: uuid('location_id'), partyId: uuid('party_id'),
  bookDate: date('book_date',{mode:'string'}).notNull(), dueDate: date('due_date',{mode:'string'}).notNull(),
  amount: bigint('amount',{mode:'bigint'}).notNull(), outstanding: bigint('outstanding',{mode:'bigint'}).notNull(),
  status: text('status').notNull().default('open'),
  voidedAt: timestamp('voided_at',{withTimezone:true}), voidedBy: text('voided_by').references(() => user.id), createdAt: created(),
}, t => [unique().on(t.tenantId,t.id), unique().on(t.tenantId,t.type,t.commandId), unique().on(t.tenantId,t.number),
  foreignKey({columns:[t.tenantId,t.unitId],foreignColumns:[units.tenantId,units.id]}),
  foreignKey({columns:[t.tenantId,t.unitId,t.locationId],foreignColumns:[locations.tenantId,locations.unitId,locations.id]}),
  foreignKey({columns:[t.tenantId,t.partyId],foreignColumns:[parties.tenantId,parties.id]}),
  check('financial_document_type',sql`${t.type} IN ('invoice','bill')`),
  check('financial_document_status',sql`${t.status} IN ('open','paid','void')`),
  check('financial_document_amount',sql`${t.amount} > 0 AND ${t.outstanding} >= 0 AND ${t.outstanding} <= ${t.amount}`),
  check('financial_document_due',sql`${t.dueDate} >= ${t.bookDate}`),
  check('financial_document_void',sql`(${t.status} = 'void') = (${t.voidedBy} IS NOT NULL)`),
  check('financial_document_state',sql`(${t.status} = 'open' AND ${t.outstanding} > 0) OR (${t.status} = 'paid' AND ${t.outstanding} = 0) OR (${t.status} = 'void')`)])
// [MBX-8][PAY-003][AUDIT-001] Append-only status trail carrying actor, reason and reference.
export const financialDocumentEvents = pgTable('financial_document_events', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id').notNull(), action: text('action').notNull(),
  actorId: text('actor_id').notNull().references(() => user.id), reason: text('reason'), reference: text('reference'), createdAt: created(),
}, t => [foreignKey({columns:[t.tenantId,t.documentId],foreignColumns:[financialDocuments.tenantId,financialDocuments.id]}),
  check('financial_document_event_action',sql`${t.action} IN ('created','allocated','paid','voided','refunded')`)])
// [MBX-8][PAY-001..003] Money received/paid. Allocation is a separate append-only row so a
// partial payment can leave both the document and the payment partially settled.
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  direction: text('direction').notNull(), number: text('number').notNull(), commandId: uuid('command_id').notNull(),
  unitId: uuid('unit_id').notNull(), locationId: uuid('location_id'), partyId: uuid('party_id').notNull(),
  cashAccountId: uuid('cash_account_id').notNull(), bookDate: date('book_date',{mode:'string'}).notNull(),
  amount: bigint('amount',{mode:'bigint'}).notNull(), allocated: bigint('allocated',{mode:'bigint'}).notNull(),
  status: text('status').notNull().default('posted'), reason: text('reason'), reference: text('reference'), createdAt: created(),
}, t => [unique().on(t.tenantId,t.id), unique().on(t.tenantId,t.commandId), unique().on(t.tenantId,t.number),
  foreignKey({columns:[t.tenantId,t.unitId],foreignColumns:[units.tenantId,units.id]}),
  foreignKey({columns:[t.tenantId,t.unitId,t.locationId],foreignColumns:[locations.tenantId,locations.unitId,locations.id]}),
  foreignKey({columns:[t.tenantId,t.partyId],foreignColumns:[parties.tenantId,parties.id]}),
  foreignKey({columns:[t.tenantId,t.cashAccountId],foreignColumns:[cashAccounts.tenantId,cashAccounts.id]}),
  check('payment_direction',sql`${t.direction} IN ('in','out')`),
  check('payment_status',sql`${t.status} IN ('posted','void')`),
  check('payment_amount',sql`${t.amount} > 0 AND ${t.allocated} >= 0 AND ${t.allocated} <= ${t.amount}`)])
export const paymentAllocations = pgTable('payment_allocations', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(),
  paymentId: uuid('payment_id').notNull(), documentId: uuid('document_id').notNull(),
  amount: bigint('amount',{mode:'bigint'}).notNull(), actorId: text('actor_id').notNull().references(() => user.id), createdAt: created(),
}, t => [foreignKey({columns:[t.tenantId,t.paymentId],foreignColumns:[payments.tenantId,payments.id]}),
  foreignKey({columns:[t.tenantId,t.documentId],foreignColumns:[financialDocuments.tenantId,financialDocuments.id]}),
  unique().on(t.tenantId,t.paymentId,t.documentId),
  check('payment_allocation_amount',sql`${t.amount} > 0`)])
