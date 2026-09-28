import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { authenticated, requireSameOrigin } from '../../../../http/context'
import { closeAccountingPeriod } from '../../../../core/accounting/engine'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const body=await readBody<{month:string}>(event)
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor)=>closeAccountingPeriod(tx,actor,body?.month,event.context.requestId))
})
