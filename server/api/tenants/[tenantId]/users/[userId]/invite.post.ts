import { defineEventHandler, getRouterParam } from 'h3'
import { authenticated, requireSameOrigin } from '../../../../../http/context'
import { resendInvitation } from '../../../../../core/iam/users'
import { deliverActivation } from '../../../../../email/activation'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const delivery = await authenticated(event, getRouterParam(event, 'tenantId'), (tx, actor) => resendInvitation(tx, actor, getRouterParam(event, 'userId') || '', event.context.requestId))
  return { ...await deliverActivation(delivery) }
})
