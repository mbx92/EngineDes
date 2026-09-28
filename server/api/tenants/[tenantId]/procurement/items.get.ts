import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { authenticated } from '../../../../http/context'
import { listItems } from '../../../../core/procurement/procurement'
export default defineEventHandler(event => {
  setHeader(event,'Cache-Control','no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor)=>listItems(tx,actor,getQuery(event)))
})
