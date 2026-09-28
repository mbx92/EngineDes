import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { authenticated, requireSameOrigin } from '../../../http/context'
import { createLocation } from '../../../core/organization/locations'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const input: unknown = await readBody(event)
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor) => createLocation(tx,actor,input,event.context.requestId))
})
