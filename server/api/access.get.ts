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
  canCreateUnit: can(actor, 'unit.create', actor.tenantId),
  canManageUsers: can(actor, 'account.manage', actor.tenantId),
  canUpdateOrganization: can(actor, 'organization.update', actor.tenantId),
})))
