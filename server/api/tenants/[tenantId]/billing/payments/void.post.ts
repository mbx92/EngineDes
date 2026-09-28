import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { authenticated, requireSameOrigin } from '../../../../../http/context'
import { voidPayment } from '../../../../../core/billing/billing'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const input: unknown = await readBody(event)
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor)=>voidPayment(tx,actor,input,event.context.requestId))
})
