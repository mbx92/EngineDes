import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Database } from '../../database/client'
import { withActor } from '../iam/context'
import { lockAdministration, createUser } from '../iam/users'
import { createUnit } from '../organization/units'
import { createLocation } from '../organization/locations'
import { saveParty } from '../party/parties'
import { setConfiguration, readConfiguration } from './configuration'
import { units, locations, parties, user, memberships } from '../../database/schema'
// [MBX-5][ORG-001/002][PARTY-001/002] Explicit local seed; no demo credentials/financial writes.
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
    for(const [key,value] of [['customer:demo_cash',{anonymousAllowed:true}],['sequence:demo_cash',{prefix:'DEMO',scope:'tenant',reset:'never'}]] as const) {
      if(!await readConfiguration(tx,tenantId,key)){await setConfiguration(tx,actor,{key,value,expectedRevision:0},randomUUID());created++}
    }
    return { created, units:3, locations:6, parties:5, pendingUsers:3 }
  })
}
