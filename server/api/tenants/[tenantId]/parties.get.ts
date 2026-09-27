import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { authenticated } from '../../../http/context'
import { listParties } from '../../../core/party/parties'
export default defineEventHandler(event => {
  setHeader(event, 'Cache-Control', 'no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor) => listParties(tx,actor, getQuery(event)))
})
