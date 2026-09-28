import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Database } from '../../database/client'
import { withActor } from '../iam/context'
import { lockAdministration, createUser } from '../iam/users'
import { createUnit } from '../organization/units'
import { createLocation } from '../organization/locations'
import { saveParty } from '../party/parties'
import { setConfiguration, readConfiguration } from './configuration'
import { createLedgerAccount, setAccountingMapping } from '../accounting/engine'
import { units, locations, parties, user, memberships, ledgerAccounts, accountingMappings } from '../../database/schema'
// [MBX-5][ORG-001/002][PARTY-001/002] Explicit local seed; no demo credentials/financial writes.

// [MBX-8][MAP-001..004] Billing posts four distinct events and each must be mapped before any
// document or payment can post. The chart below is only created if a code is unused, so an
// operator who already coded their own chart keeps it; we never relocate an existing account.
const billingChart = [
  { code: 'DEMO-1200', name: 'DEMO · Piutang Usaha', kind: 'asset' as const },
  { code: 'DEMO-2100', name: 'DEMO · Utang Usaha', kind: 'liability' as const },
  { code: 'DEMO-4100', name: 'DEMO · Pendapatan', kind: 'revenue' as const },
  { code: 'DEMO-5100', name: 'DEMO · Beban Usaha', kind: 'expense' as const },
]
// [MBX-8][SEQ-001] Billing types each need their own sequence before any document can be
// numbered. Billing always supplies a `YYYY-MM` business period, so the counter must reset per
// month; `reset: 'never'` would reject that period outright.
const billingSequences = [
  { key: 'sequence:invoice', value: { prefix: 'DEMO-INV', scope: 'tenant', reset: 'month' } },
  { key: 'sequence:bill', value: { prefix: 'DEMO-BIL', scope: 'tenant', reset: 'month' } },
  { key: 'sequence:payment', value: { prefix: 'DEMO-PAY', scope: 'tenant', reset: 'month' } },
] as const
// The whole-rupiah amount key is `total` for every billed event, matching the event contract.
const billingMappings = [
  { eventType: 'invoice_issued', debit: 'DEMO-1200', credit: 'DEMO-4100' },
  { eventType: 'bill_received', debit: 'DEMO-5100', credit: 'DEMO-2100' },
  { eventType: 'payment_received', debit: 'DEMO-1100', credit: 'DEMO-1200' },
  { eventType: 'payment_made', debit: 'DEMO-2100', credit: 'DEMO-1100' },
  // [MBX-8][PAY-003] A refund mirrors the payment it corrects: cash received is credited back
  // against receivables, cash paid is debited back against payables. No clearing account.
  { eventType: 'sales_refund', debit: 'DEMO-1200', credit: 'DEMO-1100' },
  { eventType: 'purchase_refund', debit: 'DEMO-1100', credit: 'DEMO-2100' },
] as const
export async function seedDummy(db: Database, actorId: string, tenantId: string) {
  return withActor(db,actorId,tenantId,async (tx,actor) => {
    await lockAdministration(tx,actor)
    let created = 0
    const selectedUnits: {id:string;name:string}[] = []
    for (const [code,name] of [['DEMO-TOKO','DEMO · Toko Desa'],['DEMO-AIR','DEMO · Layanan Air'],['DEMO-WISATA','DEMO · Wisata Desa']]) {
      let row = (await tx.select().from(units).where(and(eq(units.tenantId,tenantId),eq(units.code,code!))))[0]
      if (!row) { await createUnit(tx,actor,{code,name},randomUUID()); created++; row = (await tx.select().from(units).where(and(eq(units.tenantId,tenantId),eq(units.code,code!))))[0] }
      if (!row || row.name !== name) throw new Error('DEMO Unit code collision; existing data preserved')
      selectedUnits.push(row)
      for (const [locCode,locName] of [['DEMO-UTAMA','DEMO · Lokasi Utama'],['DEMO-CABANG','DEMO · Lokasi Cabang']]) {
        const existing = (await tx.select().from(locations).where(and(eq(locations.tenantId,tenantId),eq(locations.unitId,row.id),eq(locations.code,locCode!))))[0]
        if (!existing) { await createLocation(tx,actor,{unitId:row.id,code:locCode,name:locName},randomUUID()); created++ }
        else if (existing.name !== locName) throw new Error('DEMO Location code collision')
      }
    }
    const data = [
      {code:'DEMO-P01',name:'DEMO · Warga Satu',kind:'person',roles:[{role:'customer',unitId:selectedUnits[0]!.id},{role:'employee',unitId:selectedUnits[2]!.id}]},
      {code:'DEMO-P02',name:'DEMO · Warga Dua',kind:'person',roles:[{role:'customer',unitId:selectedUnits[1]!.id}]},
      {code:'DEMO-P03',name:'DEMO · Pemasok Desa',kind:'organization',roles:[{role:'vendor',unitId:null},{role:'customer',unitId:selectedUnits[0]!.id}]},
      {code:'DEMO-P04',name:'DEMO · Koperasi Contoh',kind:'organization',roles:[{role:'vendor',unitId:null}]},
      {code:'DEMO-P05',name:'DEMO · Warga Tiga',kind:'person',roles:[{role:'customer',unitId:selectedUnits[2]!.id}]},
    ]
    for (const item of data) {
      const existing=(await tx.select().from(parties).where(and(eq(parties.tenantId,tenantId),eq(parties.code,item.code))))[0]
      if (!existing) { await saveParty(tx,actor,undefined,item,randomUUID());created++ }
      else if(existing.name !== item.name)throw new Error('DEMO Party code collision')
    }
    for(const [email,name,role] of [['demo.operator@example.test','DEMO · Operator','operator'],['demo.finance@example.test','DEMO · Keuangan','finance'],['demo.director@example.test','DEMO · Direktur','director']]) {
      const existing=(await tx.select().from(user).where(eq(user.email,email!)))[0]
      if(!existing) {await createUser(tx,actor,{email,name,grants:[{role,scope:role==='operator'?'unit':'tenant',unitId:role==='operator'?selectedUnits[0]!.id:null}]},randomUUID());created++}
      else {
        const [member] = await tx.select().from(memberships).where(and(eq(memberships.userId,existing.id),eq(memberships.tenantId,tenantId)))
        if(existing.name!==name || !member)throw new Error('DEMO email collision; existing identity preserved')
      }
    }
    for(const [key,value] of [['customer:demo_cash',{anonymousAllowed:true}],['sequence:demo_cash',{prefix:'DEMO',scope:'tenant',reset:'never'}],...billingSequences.map(sequence=>[sequence.key,sequence.value] as const)] as const) {
      if(!await readConfiguration(tx,tenantId,key)){await setConfiguration(tx,actor,{key,value,expectedRevision:0},randomUUID());created++}
    }
    // [MBX-6/7] Sample chart and mapping only; never fabricate posted financial balances.
    // [MBX-8] The chart now covers the events billing actually emits, so a fresh install can
    // exercise invoice/bill/payment immediately instead of only the unused demo_cash sample.
    const chart=([
      {code:'DEMO-1100',name:'DEMO · Kas',kind:'asset'},
      ...billingChart,
    ] as const)
    const financeAccounts: { id: string; code: string; name: string; kind: string }[] = []
    for(const account of chart){
      let row=(await tx.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.tenantId,tenantId),eq(ledgerAccounts.code,account.code))))[0]
      if(!row){row=await createLedgerAccount(tx,actor,{code:account.code,name:account.name,kind:account.kind},randomUUID());created++}
      if(row.name!==account.name||row.kind!==account.kind)throw new Error('DEMO account code collision')
      financeAccounts.push(row)
    }
    const codeOf=(code:string)=>{const row=financeAccounts.find(account=>account.code===code);if(!row)throw new Error('DEMO account missing: '+code);return row.id}
    if(!(await tx.select().from(accountingMappings).where(and(eq(accountingMappings.tenantId,tenantId),eq(accountingMappings.eventType,'demo_cash'),eq(accountingMappings.schemaVersion,1))))[0]){
      await setAccountingMapping(tx,actor,{eventType:'demo_cash',schemaVersion:1,expectedRevision:0,rules:[
        {accountId:codeOf('DEMO-1100'),side:'debit',amountKey:'total',unitDimension:'event_unit'},
        {accountId:codeOf('DEMO-4100'),side:'credit',amountKey:'total',unitDimension:'event_unit'}]},randomUUID());created++
    }
    // Each billing event is mapped independently and idempotently; an existing mapping is never
    // overwritten, because setAccountingMapping is optimistic and would reject a stale revision.
    for(const mapping of billingMappings){
      const existing=await tx.select({id:accountingMappings.id}).from(accountingMappings)
        .where(and(eq(accountingMappings.tenantId,tenantId),eq(accountingMappings.eventType,mapping.eventType),eq(accountingMappings.schemaVersion,1)))
      if(existing.length)continue
      await setAccountingMapping(tx,actor,{eventType:mapping.eventType,schemaVersion:1,expectedRevision:0,rules:[
        {accountId:codeOf(mapping.debit),side:'debit',amountKey:'total',unitDimension:'event_unit'},
        {accountId:codeOf(mapping.credit),side:'credit',amountKey:'total',unitDimension:'event_unit'}]},randomUUID())
      created++
    }
    return { created, units:3, locations:6, parties:5, pendingUsers:3, ledgerAccounts:financeAccounts.length, accountingMappings:1+billingMappings.length, billingSequences:billingSequences.length }
  })
}
