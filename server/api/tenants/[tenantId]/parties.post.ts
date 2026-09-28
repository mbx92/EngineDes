import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { authenticated, requireSameOrigin } from '../../../http/context'
import { saveParty } from '../../../core/party/parties'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const input: unknown = await readBody(event)
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor) => saveParty(tx,actor,undefined, input,event.context.requestId))
})
