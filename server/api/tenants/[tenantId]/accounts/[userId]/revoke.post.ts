import { createError, defineEventHandler, getRouterParam } from 'h3'
import { authenticated, requireSameOrigin } from '../../../../../http/context'
import { revokeLogin } from '../../../../../core/iam/revoke'
export default defineEventHandler(event => {
  requireSameOrigin(event)
  const userId = getRouterParam(event, 'userId')
  if (!userId) throw createError({ statusCode: 400, statusMessage: 'User required' })
  return authenticated(event, getRouterParam(event, 'tenantId'), (tx, actor) => revokeLogin(tx, actor, userId, event.context.requestId))
})
