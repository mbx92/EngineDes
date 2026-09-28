import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { authenticated } from '../../../../http/context'
import { listQuotations } from '../../../../core/procurement/procurement'
export default defineEventHandler(event => {
  setHeader(event,'Cache-Control','no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor)=>listQuotations(tx,actor,getQuery(event)))
})
