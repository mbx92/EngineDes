import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { authenticated, requireSameOrigin } from '../../../../http/context'
import { createUser } from '../../../../core/iam/users'
import { deliverActivation } from '../../../../email/activation'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const body = await readBody(event)
  const delivery = await authenticated(event, getRouterParam(event, 'tenantId'), (tx, actor) => createUser(tx, actor, body, event.context.requestId))
  return { created: true, ...await deliverActivation(delivery) }
})
