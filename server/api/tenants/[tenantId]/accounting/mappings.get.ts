import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { eq } from 'drizzle-orm'
import { authenticated } from '../../../../http/context'
import { requirePermission } from '../../../../core/iam/access'
import { accountingMappings } from '../../../../database/schema'
export default defineEventHandler(event => {
  setHeader(event,'Cache-Control','no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),async(tx,actor)=>{
    requirePermission(actor,'financial.configure')
    return tx.select().from(accountingMappings).where(eq(accountingMappings.tenantId,actor.tenantId)).orderBy(accountingMappings.eventType)
  })
})
