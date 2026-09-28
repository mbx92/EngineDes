import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { authenticated, requireSameOrigin } from '../../../../http/context'
import { createLedgerAccount } from '../../../../core/accounting/engine'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  const input:unknown=await readBody(event)
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor)=>createLedgerAccount(tx,actor,input,event.context.requestId))
})
