import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { authenticated, requireSameOrigin } from '../../../http/context'
import { setConfiguration } from '../../../core/governance/configuration'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const input: unknown = await readBody(event)
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor) => setConfiguration(tx,actor,input,event.context.requestId))
})
