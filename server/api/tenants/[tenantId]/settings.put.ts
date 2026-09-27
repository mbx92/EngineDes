import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { authenticated, requireSameOrigin } from '../../../http/context'
import { updateOrganization } from '../../../core/organization/settings'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const body = await readBody(event)
  return authenticated(event, getRouterParam(event, 'tenantId'), (tx, actor) => updateOrganization(tx, actor, body, event.context.requestId))
})
