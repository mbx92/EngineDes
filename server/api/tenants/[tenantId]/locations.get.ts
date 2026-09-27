import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { authenticated } from '../../../http/context'
import { listLocations } from '../../../core/organization/locations'
export default defineEventHandler(event => {
  setHeader(event, 'Cache-Control', 'no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor) => listLocations(tx,actor, Number(getQuery(event).page || 1)))
})
