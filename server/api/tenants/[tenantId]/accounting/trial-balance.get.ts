import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { authenticated } from '../../../../http/context'
import { trialBalance } from '../../../../core/accounting/engine'
export default defineEventHandler(event => {
  setHeader(event,'Cache-Control','no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor)=>trialBalance(tx,actor,getQuery(event)))
})
