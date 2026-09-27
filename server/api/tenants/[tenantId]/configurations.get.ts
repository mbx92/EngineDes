import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { authenticated } from '../../../http/context'
import { listConfigurations } from '../../../core/governance/configuration'
export default defineEventHandler(event => {
  setHeader(event, 'Cache-Control', 'no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor) => listConfigurations(tx,actor))
})
