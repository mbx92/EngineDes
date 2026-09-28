import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { authenticated } from '../../../../http/context'
import { listRfqs } from '../../../../core/procurement/procurement'
export default defineEventHandler(event => {
  setHeader(event,'Cache-Control','no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor)=>listRfqs(tx,actor,getQuery(event)))
})
