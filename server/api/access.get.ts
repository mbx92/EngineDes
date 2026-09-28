import { defineEventHandler } from 'h3'
import { authenticated } from '../http/context'
import { can } from '../core/iam/access'
import { tenants } from '../database/schema'
import { eq } from 'drizzle-orm'
export default defineEventHandler(event => authenticated(event, undefined, async (tx, actor) => ({
  tenantId: actor.tenantId, grants: actor.grants,
  tenantName: (await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, actor.tenantId)))[0]?.name,
  canManageParties: can(actor, 'party.manage', actor.tenantId),
  canManageLocations: can(actor, 'location.manage', actor.tenantId),
  canReadAccounting: actor.grants.some(grant => !grant.locationId && can(actor,'financial.read',actor.tenantId,grant.unitId || undefined)),
  canViewAllAccounting: can(actor,'financial.read',actor.tenantId),
  canManageAccounting: can(actor,'financial.configure',actor.tenantId),
  canCloseAccounting: can(actor,'period.close',actor.tenantId),
  canCreateUnit: can(actor, 'unit.create', actor.tenantId),
  canManageUsers: can(actor, 'account.manage', actor.tenantId),
  canUpdateOrganization: can(actor, 'organization.update', actor.tenantId),
  // [MBX-8][CASH-001][BILL-001..003][PAY-001..003] Billing capabilities follow the Phase 2
  // boundary: Admin configures, Finance posts inside assigned Unit scope.
  canReadBilling: actor.grants.some(grant => !grant.locationId && can(actor,'financial.read',actor.tenantId,grant.unitId || undefined)),
  canManageCashAccounts: can(actor,'financial.configure',actor.tenantId),
  canPostBilling: actor.grants.some(grant => !grant.locationId && can(actor,'financial.post',actor.tenantId,grant.unitId || undefined)),
})))
