import { defineEventHandler, getRouterParam, getQuery, setHeader } from 'h3'
import { authenticated } from '../../../../http/context'
import { compareQuotations } from '../../../../core/procurement/comparison'
// [MBX-10][PROC-004] Read-only vendor comparison. It is a computed view, so it is a GET with no
// corresponding write route and nothing to audit.
export default defineEventHandler(event => {
  setHeader(event,'Cache-Control','no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),(tx,actor)=>compareQuotations(tx,actor,getQuery(event)))
})
