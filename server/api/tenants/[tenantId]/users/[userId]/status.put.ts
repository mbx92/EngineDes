import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { authenticated, requireSameOrigin } from '../../../../../http/context'
import { setAccountActive } from '../../../../../core/iam/users'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const body = await readBody(event)
  return authenticated(event, getRouterParam(event, 'tenantId'), (tx, actor) => setAccountActive(tx, actor, getRouterParam(event, 'userId') || '', body, event.context.requestId))
})
