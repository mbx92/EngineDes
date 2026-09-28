<script setup lang="ts">
// [MBX-6][MBX-7][ACC-004][MAP-001][LOCK-001] Financial setup and posted-ledger inspection.
type Account={id:string;code:string;name:string;kind:string}
type Mapping={id:string;eventType:string;schemaVersion:number;revision:number;rules:{accountId:string;side:string;amountKey:string}[]}
type Period={id:string;month:string;closedAt:string}
type Balance={accountId:string;code:string;name:string;debit:string;credit:string}
type Ledger={openingBalance:string;entries:{journal_id:string;book_date:string;line_no:number;unit_id:string;debit:string;credit:string;runningBalance:string}[]}
type Unit={id:string;name:string}
const props=defineProps<{tenantId:string;canManage:boolean;canClose:boolean;canViewAll:boolean;assignedUnitIds:string[]}>()
const root=computed(()=>`/api/tenants/${props.tenantId}/accounting`)
const accounts=ref<Account[]>([]),mappings=ref<Mapping[]>([]),periods=ref<Period[]>([]),units=ref<Unit[]>([])
const balance=ref<Balance[]>([]),ledger=ref<Ledger|null>(null),busy=ref(false),message=ref(''),success=ref(false)
const accountCode=ref(''),accountName=ref(''),accountKind=ref('asset')
const eventType=ref(''),amountKey=ref('total'),debitAccount=ref(''),creditAccount=ref('')
const closeMonth=ref(''),from=ref(''),through=ref(''),unitId=ref(''),ledgerAccount=ref('')
const idr=(value:string)=>new Intl.NumberFormat('id-ID').format(BigInt(value||'0'))
async function load(){
  busy.value=true;message.value=''
  try {
    const [a,p]=await Promise.all([$fetch<Account[]>(root.value+'/accounts'),$fetch<Period[]>(root.value+'/periods')])
    accounts.value=a;periods.value=p
    if(props.canManage) mappings.value=await $fetch<Mapping[]>(root.value+'/mappings')
    const all:Unit[]=[]
    for(let page=1;page<=1000;page++){
      const batch=await $fetch<Unit[]>(`/api/tenants/${props.tenantId}/units`,{query:{page}})
      all.push(...batch)
      if(batch.length<50) break
    }
    units.value=all.filter(unit=>props.canViewAll||props.assignedUnitIds.includes(unit.id))
    if(!props.canViewAll&&!unitId.value) unitId.value=units.value[0]?.id||''
  }catch{message.value='Data akuntansi belum dapat dimuat.';success.value=false}
  finally{busy.value=false}
}
async function save(task:()=>Promise<unknown>,confirmation:string){
  busy.value=true;message.value='';success.value=false
  try{await task();await load();message.value=confirmation;success.value=true}
  catch{message.value='Perubahan belum berhasil. Periksa data, periode dan akses Anda.'}
  finally{busy.value=false}
}
async function addAccount(){await save(()=>$fetch(root.value+'/accounts',{method:'POST',body:{code:accountCode.value,name:accountName.value,kind:accountKind.value}}),'Akun berhasil dibuat.');accountCode.value='';accountName.value=''}
async function addMapping(){
  if(debitAccount.value===creditAccount.value){message.value='Pilih dua akun yang berbeda.';success.value=false;return}
  await save(()=>$fetch(root.value+'/mappings',{method:'POST',body:{eventType:eventType.value,schemaVersion:1,expectedRevision:0,rules:[
    {accountId:debitAccount.value,side:'debit',amountKey:amountKey.value,unitDimension:'event_unit'},
    {accountId:creditAccount.value,side:'credit',amountKey:amountKey.value,unitDimension:'event_unit'}]}}),'Mapping berhasil dibuat.')
}
async function closePeriod(){await save(()=>$fetch(root.value+'/periods',{method:'POST',body:{month:closeMonth.value}}),'Periode berhasil ditutup.')}
async function loadReports(){
  if(!through.value||(!props.canViewAll&&!unitId.value)) return
  busy.value=true;message.value='';success.value=false
  try{
    const query={through:through.value,...(from.value?{from:from.value}:{}),...(unitId.value?{unitId:unitId.value}:{})}
    balance.value=await $fetch<Balance[]>(root.value+'/trial-balance',{query})
    ledger.value=ledgerAccount.value&&from.value?await $fetch<Ledger>(root.value+'/ledger',{query:{accountId:ledgerAccount.value,from:from.value,through:through.value,...(unitId.value?{unitId:unitId.value}:{})}}):null
  }catch{message.value='Laporan belum dapat dimuat. Periksa tanggal dan Unit Usaha.'}
  finally{busy.value=false}
}
onMounted(load)
</script>
<template>
  <div class="accounting-stack" :aria-busy="busy">
    <p v-if="message" :class="['notice',success?'success':'error']" :role="success?'status':'alert'">{{ message }}</p>
    <section class="panel"><div class="panel-heading"><div><h2>Bagan akun</h2><p>Akun berlaku untuk seluruh BUMDes; Unit dicatat pada baris jurnal.</p></div><button class="button secondary" :disabled="busy" @click="load"><AppIcon name="refresh" :size="16" />Muat ulang</button></div>
      <div v-if="!accounts.length" class="empty-state">Belum ada akun.</div>
      <div v-else class="table-scroll"><table><thead><tr><th>Kode</th><th>Nama akun</th><th>Jenis</th></tr></thead><tbody><tr v-for="a in accounts" :key="a.id"><td>{{ a.code }}</td><td>{{ a.name }}</td><td>{{ a.kind }}</td></tr></tbody></table></div>
      <form v-if="canManage" class="accounting-form" @submit.prevent="addAccount"><h3>Tambah akun</h3><div class="accounting-grid"><label class="field">Kode<input v-model="accountCode" required maxlength="32" placeholder="1100" :disabled="busy"></label><label class="field">Nama<input v-model="accountName" required maxlength="160" placeholder="Kas" :disabled="busy"></label><label class="field">Jenis<select v-model="accountKind" :disabled="busy"><option value="asset">Aset</option><option value="liability">Liabilitas</option><option value="equity">Ekuitas</option><option value="revenue">Pendapatan</option><option value="expense">Beban</option></select></label></div><button class="button primary" :disabled="busy">Simpan akun</button></form>
    </section>
    <section v-if="canManage" class="panel"><div class="panel-heading"><div><h2>Mapping event</h2><p>Aturan menghubungkan nilai event ke akun debit dan kredit. Modul bisnis tidak memilih akun.</p></div></div>
      <div v-if="!mappings.length" class="empty-state">Belum ada mapping.</div><div v-else class="table-scroll"><table><thead><tr><th>Event</th><th>Versi</th><th>Revisi</th><th>Baris</th></tr></thead><tbody><tr v-for="m in mappings" :key="m.id"><td>{{ m.eventType }}</td><td>{{ m.schemaVersion }}</td><td>{{ m.revision }}</td><td>{{ m.rules.length }}</td></tr></tbody></table></div>
      <form class="accounting-form" @submit.prevent="addMapping"><h3>Tambah mapping sederhana</h3><p>Satu nilai event yang diposting ke dua akun dengan Unit dari event.</p><div class="accounting-grid"><label class="field">Jenis event<input v-model="eventType" required pattern="[a-z][a-z0-9_]*" placeholder="sale" :disabled="busy"></label><label class="field">Nama nilai<input v-model="amountKey" required pattern="[a-z][a-z0-9_]*" placeholder="total" :disabled="busy"></label><label class="field">Akun debit<select v-model="debitAccount" required :disabled="busy"><option value="">Pilih akun</option><option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label><label class="field">Akun kredit<select v-model="creditAccount" required :disabled="busy"><option value="">Pilih akun</option><option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label></div><button class="button primary" :disabled="busy||accounts.length<2">Simpan mapping</button></form>
    </section>
    <section class="panel"><div class="panel-heading"><div><h2>Neraca saldo & buku besar</h2><p>Hanya jurnal yang sudah diposting. Nilai ditampilkan dalam rupiah bulat.</p></div></div>
      <form class="accounting-form" @submit.prevent="loadReports"><div class="accounting-grid"><label class="field">Dari tanggal<input v-model="from" type="date" :disabled="busy"></label><label class="field">Sampai tanggal<input v-model="through" type="date" required :disabled="busy"></label><label class="field">Unit Usaha<select v-model="unitId" :disabled="busy"><option v-if="canViewAll" value="">Konsolidasi BUMDes</option><option v-for="u in units" :key="u.id" :value="u.id">{{ u.name }}</option></select></label><label class="field">Buku besar akun<select v-model="ledgerAccount" :disabled="busy"><option value="">Tanpa rincian akun</option><option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} · {{ a.name }}</option></select></label></div><button class="button primary" :disabled="busy">Tampilkan laporan</button></form>
      <div v-if="balance.length" class="table-scroll"><table><thead><tr><th>Kode</th><th>Akun</th><th>Debit (Rp)</th><th>Kredit (Rp)</th></tr></thead><tbody><tr v-for="b in balance" :key="b.accountId"><td>{{ b.code }}</td><td>{{ b.name }}</td><td>{{ idr(b.debit) }}</td><td>{{ idr(b.credit) }}</td></tr></tbody><tfoot><tr><th colspan="2">Total</th><th>{{ idr(balance.reduce((sum,b)=>sum+BigInt(b.debit),0n).toString()) }}</th><th>{{ idr(balance.reduce((sum,b)=>sum+BigInt(b.credit),0n).toString()) }}</th></tr></tfoot></table></div>
      <div v-if="ledger" class="table-scroll"><table><thead><tr><th>Tanggal</th><th>Jurnal</th><th>Debit (Rp)</th><th>Kredit (Rp)</th><th>Saldo debit bersih (Rp)</th></tr></thead><tbody><tr><td colspan="4">Saldo awal</td><td>{{ idr(ledger.openingBalance) }}</td></tr><tr v-for="e in ledger.entries" :key="e.journal_id+'-'+e.line_no"><td>{{ e.book_date }}</td><td>{{ e.journal_id }}</td><td>{{ idr(e.debit) }}</td><td>{{ idr(e.credit) }}</td><td>{{ idr(e.runningBalance) }}</td></tr></tbody></table></div>
    </section>
    <section class="panel"><div class="panel-heading"><div><h2>Periode ditutup</h2><p>Posting biasa dan koreksi ke bulan yang ditutup akan ditolak.</p></div></div><div v-if="!periods.length" class="empty-state">Belum ada periode ditutup.</div><div v-else class="table-scroll"><table><thead><tr><th>Periode</th><th>Ditutup pada</th></tr></thead><tbody><tr v-for="p in periods" :key="p.id"><td>{{ p.month }}</td><td>{{ new Date(p.closedAt).toLocaleString('id-ID') }}</td></tr></tbody></table></div><form v-if="canClose" class="accounting-form" @submit.prevent="closePeriod"><label class="field">Tutup periode<input v-model="closeMonth" type="month" required :disabled="busy"></label><button class="button primary" :disabled="busy">Tutup periode</button></form></section>
  </div>
</template>
<style scoped>
.accounting-stack{display:grid;gap:20px}.accounting-form{border-top:1px solid #e7edf2;margin-top:20px;padding-top:20px}.accounting-form h3{font-size:16px;margin:0 0 12px}.accounting-form p{color:#64748b;margin:0 0 16px}.accounting-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px}.accounting-form .button{margin-top:8px}.accounting-form .field{margin:0 0 10px}@media(max-width:700px){.accounting-grid{grid-template-columns:1fr}}
</style>
