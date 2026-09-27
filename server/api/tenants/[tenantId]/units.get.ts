import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { authenticated } from '../../../http/context'
import { listUnits, unitPageInput } from '../../../core/organization/units'
export default defineEventHandler(event => authenticated(event, getRouterParam(event, 'tenantId'), (tx, actor) => {
  const page = unitPageInput.parse(getQuery(event).page)
  return listUnits(tx, actor, page)
}))
