import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { eq } from 'drizzle-orm'
import { authenticated } from '../../../../http/context'
import { AccessDenied, can } from '../../../../core/iam/access'
import { ledgerAccounts } from '../../../../database/schema'
export default defineEventHandler(event => {
  setHeader(event,'Cache-Control','no-store')
  return authenticated(event,getRouterParam(event,'tenantId'),async(tx,actor)=>{
    if(!actor.grants.some(grant=>!grant.locationId && can(actor,'financial.read',actor.tenantId,grant.unitId || undefined))) throw new AccessDenied('Financial read denied')
    return tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.tenantId,actor.tenantId)).orderBy(ledgerAccounts.code)
  })
})
