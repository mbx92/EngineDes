import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { authenticated, requireSameOrigin } from '../../../http/context'
import { createUnit } from '../../../core/organization/units'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const body: unknown = await readBody(event)
  const result = await authenticated(event, getRouterParam(event, 'tenantId'), (tx, actor) => createUnit(tx, actor, body, event.context.requestId))
  setResponseStatus(event, 201)
  return result
})
