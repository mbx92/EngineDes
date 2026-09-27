import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { authenticated } from '../../../http/context'
import { listAudit } from '../../../core/governance/audit'
export default defineEventHandler(event => {
  setHeader(event, 'Cache-Control', 'no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor) => listAudit(tx,actor, Number(getQuery(event).page || 1)))
})
