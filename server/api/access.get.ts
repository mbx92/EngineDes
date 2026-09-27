import { defineEventHandler } from 'h3'
import { authenticated } from '../http/context'
import { can } from '../core/iam/access'
export default defineEventHandler(event => authenticated(event, undefined, async (_tx, actor) => ({
  tenantId: actor.tenantId, grants: actor.grants,
  canCreateUnit: can(actor, 'unit.create', actor.tenantId),
})))
