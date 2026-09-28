<script setup lang="ts">
// [MBX-6][MBX-7][ACC-004][MAP-001][LOCK-001] Financial setup and posted-ledger inspection.
type Account = { id: string; code: string; name: string; kind: string }
type Mapping = { id: string; eventType: string; schemaVersion: number; revision: number; rules: { accountId: string; side: string; amountKey: string }[] }
type Period = { id: string; month: string; closedAt: string }
type Balance = { accountId: string; code: string; name: string; debit: string; credit: string }
type Ledger = { openingBalance: string; entries: { journal_id: string; book_date: string; line_no: number; unit_id: string; debit: string; credit: string; runningBalance: string }[] }
type Unit = { id: string; name: string }

const props = defineProps<{ tenantId: string; canManage: boolean; canClose: boolean; canViewAll: boolean; assignedUnitIds: string[] }>()
const root = computed(() => `/api/tenants/${props.tenantId}/accounting`)
const accounts = ref<Account[]>([]), mappings = ref<Mapping[]>([]), periods = ref<Period[]>([]), units = ref<Unit[]>([])
const balance = ref<Balance[]>([]), ledger = ref<Ledger | null>(null), busy = ref(false), message = ref(''), success = ref(false)
const accountCode = ref(''), accountName = ref(''), accountKind = ref('asset')
const eventType = ref(''), amountKey = ref('total'), debitAccount = ref(''), creditAccount = ref('')
const closeMonth = ref(''), from = ref(''), through = ref(''), unitId = ref(''), ledgerAccount = ref('')
const allTabs = ['accounts', 'mapping', 'reports', 'periods'] as const
type AccountingTab = (typeof allTabs)[number]
const tabs = computed<readonly AccountingTab[]>(() => props.canManage ? allTabs : allTabs.filter(tab => tab !== 'mapping'))
const activeTab = ref<AccountingTab>('accounts'), tabId = useId()
const tabLabels = { accounts: 'Bagan Akun', mapping: 'Mapping', reports: 'Laporan', periods: 'Periode' }
const kindLabels: Record<string, string> = { asset: 'Aset', liability: 'Liabilitas', equity: 'Ekuitas', revenue: 'Pendapatan', expense: 'Beban' }
const idr = (value: string) => new Intl.NumberFormat('id-ID').format(BigInt(value || '0'))
const accountNameById = (id: string) => accounts.value.find(account => account.id === id)
const totalDebit = computed(() => balance.value.reduce((sum, row) => sum + BigInt(row.debit), 0n).toString())
const totalCredit = computed(() => balance.value.reduce((sum, row) => sum + BigInt(row.credit), 0n).toString())
const shortId = (id: string) => id.slice(0, 8).toUpperCase()

function navigateTabs(event: KeyboardEvent) {
  const index = tabs.value.indexOf(activeTab.value)
  let next: number
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.value.length
  else if (event.key === 'ArrowLeft') next = (index + tabs.value.length - 1) % tabs.value.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.value.length - 1
  else return
  event.preventDefault(); activeTab.value = tabs.value[next]!
  ;(event.currentTarget as HTMLButtonElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
}
async function load() {
  busy.value = true; message.value = ''
  try {
    const [accountRows, periodRows] = await Promise.all([$fetch<Account[]>(root.value + '/accounts'), $fetch<Period[]>(root.value + '/periods')])
    accounts.value = accountRows; periods.value = periodRows
    if (props.canManage) mappings.value = await $fetch<Mapping[]>(root.value + '/mappings')
    const all: Unit[] = []
    for (let page = 1; page <= 1000; page++) {
      const batch = await $fetch<Unit[]>(`/api/tenants/${props.tenantId}/units`, { query: { page } }); all.push(...batch)
      if (batch.length < 50) break
    }
    units.value = all.filter(unit => props.canViewAll || props.assignedUnitIds.includes(unit.id))
    if (!props.canViewAll && !unitId.value) unitId.value = units.value[0]?.id || ''
  } catch { message.value = 'Data akuntansi belum dapat dimuat.'; success.value = false }
  finally { busy.value = false }
}
async function save(task: () => Promise<unknown>, confirmation: string) {
  busy.value = true; message.value = ''; success.value = false
  try { await task(); await load(); message.value = confirmation; success.value = true }
  catch { message.value = 'Perubahan belum berhasil. Periksa data, periode dan akses Anda.' }
  finally { busy.value = false }
}
async function addAccount() {
  await save(() => $fetch(root.value + '/accounts', { method: 'POST', body: { code: accountCode.value, name: accountName.value, kind: accountKind.value } }), 'Akun berhasil dibuat.')
  if (success.value) { accountCode.value = ''; accountName.value = '' }
}
async function addMapping() {
  if (debitAccount.value === creditAccount.value) { message.value = 'Pilih dua akun yang berbeda.'; success.value = false; return }
  await save(() => $fetch(root.value + '/mappings', { method: 'POST', body: { eventType: eventType.value, schemaVersion: 1, expectedRevision: 0, rules: [
    { accountId: debitAccount.value, side: 'debit', amountKey: amountKey.value, unitDimension: 'event_unit' },
    { accountId: creditAccount.value, side: 'credit', amountKey: amountKey.value, unitDimension: 'event_unit' },
  ] } }), 'Mapping berhasil dibuat.')
  if (success.value) { eventType.value = ''; debitAccount.value = ''; creditAccount.value = '' }
}
async function closePeriod() {
  await save(() => $fetch(root.value + '/periods', { method: 'POST', body: { month: closeMonth.value } }), 'Periode berhasil ditutup.')
  if (success.value) closeMonth.value = ''
}
async function loadReports() {
  if (!through.value || (!props.canViewAll && !unitId.value)) return
  busy.value = true; message.value = ''; success.value = false
  try {
    const query = { through: through.value, ...(from.value ? { from: from.value } : {}), ...(unitId.value ? { unitId: unitId.value } : {}) }
    balance.value = await $fetch<Balance[]>(root.value + '/trial-balance', { query })
    ledger.value = ledgerAccount.value && from.value ? await $fetch<Ledger>(root.value + '/ledger', { query: { accountId: ledgerAccount.value, from: from.value, through: through.value, ...(unitId.value ? { unitId: unitId.value } : {}) } }) : null
  } catch { message.value = 'Laporan belum dapat dimuat. Periksa tanggal dan Unit Usaha.' }
  finally { busy.value = false }
}
onMounted(() => {
  through.value = new Date().toISOString().slice(0, 10); from.value = `${through.value.slice(0, 7)}-01`; load()
})
</script>

<template>
  <section class="accounting-page" :aria-busy="busy">
    <div class="accounting-overview">
      <div><span class="eyebrow muted">KEUANGAN BUMDES</span><h2>Akuntansi</h2><p>Kelola struktur akun, aturan jurnal, laporan, dan periode dalam satu tempat.</p></div>
      <div class="accounting-summary" aria-label="Ringkasan akuntansi"><div><strong>{{ accounts.length }}</strong><span>Akun</span></div><div v-if="canManage"><strong>{{ mappings.length }}</strong><span>Mapping</span></div><div><strong>{{ periods.length }}</strong><span>Periode ditutup</span></div><span class="currency-badge">IDR · Rupiah bulat</span></div>
    </div>
    <p v-if="message" :class="['notice', success ? 'success' : 'error']" :role="success ? 'status' : 'alert'">{{ message }}</p>
    <div class="accounting-tabs" role="tablist" aria-label="Bagian akuntansi">
      <button v-for="tab in tabs" :id="`${tabId}-${tab}-tab`" :key="tab" type="button" role="tab" :aria-selected="activeTab === tab" :aria-controls="`${tabId}-${tab}-panel`" :tabindex="activeTab === tab ? 0 : -1" @click="activeTab = tab" @keydown="navigateTabs"><AppIcon :name="tab === 'accounts' ? 'layers' : tab === 'mapping' ? 'refresh' : tab === 'reports' ? 'grid' : 'clock'" :size="17" />{{ tabLabels[tab] }}</button>
      <button class="accounting-reload" type="button" :disabled="busy" aria-label="Muat ulang data akuntansi" @click="load"><AppIcon name="refresh" :size="16" /><span>Muat ulang</span></button>
    </div>

    <div v-show="activeTab === 'accounts'" :id="`${tabId}-accounts-panel`" class="accounting-layout" role="tabpanel" :aria-labelledby="`${tabId}-accounts-tab`" tabindex="0">
      <section class="panel accounting-main-card"><div class="panel-heading"><div><h2>Bagan akun</h2><p>Akun digunakan bersama oleh seluruh Unit Usaha.</p></div><span class="count-badge">{{ accounts.length }} akun</span></div><div v-if="!accounts.length" class="empty-state"><h3>Belum ada akun</h3><p>Tambahkan akun pertama untuk menyiapkan mapping jurnal.</p></div><div v-else class="table-scroll"><table><thead><tr><th>Kode</th><th>Nama akun</th><th>Jenis</th></tr></thead><tbody><tr v-for="account in accounts" :key="account.id"><td><span class="account-code">{{ account.code }}</span></td><td><strong>{{ account.name }}</strong></td><td><span :class="['account-kind', account.kind]">{{ kindLabels[account.kind] || account.kind }}</span></td></tr></tbody></table></div></section>
      <aside v-if="canManage" class="panel accounting-action-card"><span class="action-icon"><AppIcon name="plus" :size="18" /></span><h3>Tambah akun</h3><p>Buat akun baru dalam bagan akun BUMDes.</p><form @submit.prevent="addAccount"><label class="field">Kode akun<input v-model="accountCode" required maxlength="32" placeholder="Contoh: 1100" :disabled="busy"></label><label class="field">Nama akun<input v-model="accountName" required maxlength="160" placeholder="Contoh: Kas" :disabled="busy"></label><label class="field">Jenis akun<select v-model="accountKind" :disabled="busy"><option value="asset">Aset</option><option value="liability">Liabilitas</option><option value="equity">Ekuitas</option><option value="revenue">Pendapatan</option><option value="expense">Beban</option></select></label><button class="button primary accounting-submit" :disabled="busy">{{ busy ? 'Menyimpan…' : 'Simpan akun' }}</button></form></aside>
    </div>

    <div v-show="activeTab === 'mapping'" :id="`${tabId}-mapping-panel`" class="accounting-layout" role="tabpanel" :aria-labelledby="`${tabId}-mapping-tab`" tabindex="0">
      <section class="panel accounting-main-card"><div class="panel-heading"><div><h2>Mapping event</h2><p>Aturan jurnal yang digunakan oleh modul bisnis.</p></div><span class="count-badge">{{ mappings.length }} mapping</span></div><div v-if="!mappings.length" class="empty-state"><h3>Belum ada mapping</h3><p>Mapping menentukan akun debit dan kredit dari setiap event bisnis.</p></div><div v-else class="mapping-list"><article v-for="mapping in mappings" :key="mapping.id" class="mapping-row"><div class="mapping-title"><span class="action-icon compact"><AppIcon name="refresh" :size="16" /></span><div><strong>{{ mapping.eventType }}</strong><small>Schema v{{ mapping.schemaVersion }} · Revisi {{ mapping.revision }}</small></div></div><div class="mapping-flow"><template v-for="rule in mapping.rules" :key="`${rule.accountId}-${rule.side}-${rule.amountKey}`"><span :class="['side-badge', rule.side]">{{ rule.side === 'debit' ? 'Debit' : 'Kredit' }}</span><span>{{ accountNameById(rule.accountId)?.code || 'Akun' }} · {{ accountNameById(rule.accountId)?.name || 'Tidak tersedia' }}</span><small>{{ rule.amountKey }}</small></template></div></article></div></section>
      <aside v-if="canManage" class="panel accounting-action-card"><span class="action-icon"><AppIcon name="refresh" :size="18" /></span><h3>Tambah mapping</h3><p>Hubungkan satu nilai event ke pasangan akun debit dan kredit.</p><form @submit.prevent="addMapping"><div class="form-pair"><label class="field">Jenis event<input v-model="eventType" required pattern="[a-z][a-z0-9_]*" placeholder="Contoh: sale" :disabled="busy"><small>Huruf kecil dan garis bawah.</small></label><label class="field">Nama nilai<input v-model="amountKey" required pattern="[a-z][a-z0-9_]*" placeholder="total" :disabled="busy"></label></div><label class="field">Akun debit<select v-model="debitAccount" required :disabled="busy"><option value="">Pilih akun debit</option><option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.code }} · {{ account.name }}</option></select></label><label class="field">Akun kredit<select v-model="creditAccount" required :disabled="busy"><option value="">Pilih akun kredit</option><option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.code }} · {{ account.name }}</option></select></label><button class="button primary accounting-submit" :disabled="busy || accounts.length < 2">{{ busy ? 'Menyimpan…' : 'Simpan mapping' }}</button></form></aside>
    </div>

    <div v-show="activeTab === 'reports'" :id="`${tabId}-reports-panel`" class="report-stack" role="tabpanel" :aria-labelledby="`${tabId}-reports-tab`" tabindex="0">
      <section class="panel report-filter-card"><div><h2>Neraca saldo & buku besar</h2><p>Pilih periode, Unit, dan akun untuk menyusun laporan.</p></div><form @submit.prevent="loadReports"><div class="report-filters"><label class="field">Dari tanggal<input v-model="from" type="date" :disabled="busy"></label><label class="field">Sampai tanggal<input v-model="through" type="date" required :disabled="busy"></label><label class="field">Unit Usaha<select v-model="unitId" :disabled="busy"><option v-if="canViewAll" value="">Konsolidasi BUMDes</option><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label><label class="field">Rincian buku besar<select v-model="ledgerAccount" :disabled="busy"><option value="">Tidak ditampilkan</option><option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.code }} · {{ account.name }}</option></select></label></div><button class="button primary" :disabled="busy"><AppIcon name="search" :size="16" />{{ busy ? 'Menyusun…' : 'Tampilkan laporan' }}</button></form></section>
      <section class="panel report-result-card"><div class="panel-heading"><div><h2>Neraca saldo</h2><p>Saldo akun dalam rupiah untuk filter yang dipilih.</p></div><span v-if="balance.length" class="status-pill active">Seimbang</span></div><div v-if="!balance.length" class="empty-state report-empty"><AppIcon name="grid" :size="30" /><h3>Belum ada hasil laporan</h3><p>Tentukan filter lalu pilih “Tampilkan laporan”.</p></div><div v-else class="table-scroll financial-table"><table><thead><tr><th>Kode</th><th>Akun</th><th class="number-column">Debit (Rp)</th><th class="number-column">Kredit (Rp)</th></tr></thead><tbody><tr v-for="row in balance" :key="row.accountId"><td><span class="account-code">{{ row.code }}</span></td><td><strong>{{ row.name }}</strong></td><td class="number-column">{{ idr(row.debit) }}</td><td class="number-column">{{ idr(row.credit) }}</td></tr></tbody><tfoot><tr><th colspan="2">Total</th><th class="number-column">{{ idr(totalDebit) }}</th><th class="number-column">{{ idr(totalCredit) }}</th></tr></tfoot></table></div></section>
      <section v-if="ledger" class="panel report-result-card"><div class="panel-heading"><div><h2>Buku besar</h2><p>{{ accountNameById(ledgerAccount)?.code }} · {{ accountNameById(ledgerAccount)?.name }}</p></div><span class="count-badge">{{ ledger.entries.length }} baris</span></div><div v-if="!ledger.entries.length" class="empty-state">Tidak ada mutasi pada periode ini.</div><div v-else class="table-scroll financial-table ledger-table"><table><thead><tr><th>Tanggal</th><th>Jurnal</th><th class="number-column">Debit (Rp)</th><th class="number-column">Kredit (Rp)</th><th class="number-column">Saldo (Rp)</th></tr></thead><tbody><tr class="opening-row"><td colspan="4">Saldo awal</td><td class="number-column">{{ idr(ledger.openingBalance) }}</td></tr><tr v-for="entry in ledger.entries" :key="entry.journal_id + '-' + entry.line_no"><td>{{ entry.book_date }}</td><td><span class="journal-id" :title="entry.journal_id">{{ shortId(entry.journal_id) }}</span></td><td class="number-column">{{ idr(entry.debit) }}</td><td class="number-column">{{ idr(entry.credit) }}</td><td class="number-column"><strong>{{ idr(entry.runningBalance) }}</strong></td></tr></tbody></table></div></section>
    </div>

    <div v-show="activeTab === 'periods'" :id="`${tabId}-periods-panel`" class="accounting-layout" role="tabpanel" :aria-labelledby="`${tabId}-periods-tab`" tabindex="0">
      <section class="panel accounting-main-card"><div class="panel-heading"><div><h2>Riwayat periode ditutup</h2><p>Periode terkunci tidak menerima posting atau koreksi baru.</p></div><span class="count-badge">{{ periods.length }} periode</span></div><div v-if="!periods.length" class="empty-state"><h3>Belum ada periode ditutup</h3><p>Riwayat penutupan akan ditampilkan di sini.</p></div><div v-else class="period-list"><article v-for="period in periods" :key="period.id"><span class="period-icon"><AppIcon name="lock" :size="17" /></span><div><strong>{{ period.month }}</strong><small>Ditutup {{ new Date(period.closedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) }}</small></div><span class="status-pill inactive">Terkunci</span></article></div></section>
      <aside v-if="canClose" class="panel accounting-action-card period-action"><span class="action-icon warning"><AppIcon name="lock" :size="18" /></span><h3>Tutup periode</h3><p>Pastikan seluruh transaksi bulan tersebut sudah diposting. Tindakan ini tidak dapat dibatalkan melalui alur biasa.</p><form @submit.prevent="closePeriod"><label class="field">Bulan akuntansi<input v-model="closeMonth" type="month" required :disabled="busy"></label><button class="button primary accounting-submit" :disabled="busy">{{ busy ? 'Memproses…' : 'Tutup periode' }}</button></form></aside>
    </div>
  </section>
</template>

<style scoped>
.accounting-page{display:grid;gap:18px}.accounting-overview{display:flex;align-items:center;justify-content:space-between;gap:28px;padding:22px 24px;border:1px solid #e2e9ee;border-radius:13px;background:linear-gradient(120deg,#fff 62%,#f1f8f5)}.accounting-overview h2{font-size:21px;margin:5px 0 6px}.accounting-overview p{margin:0;color:#7d8998;font-size:12px}.accounting-summary{display:flex;align-items:center;gap:22px;flex-shrink:0}.accounting-summary>div{display:grid;gap:2px;min-width:58px}.accounting-summary strong{font-size:20px;color:#243146}.accounting-summary span{font-size:10px;color:#8d99a8}.currency-badge{padding:7px 10px;border-radius:999px;background:#e4f5ef;color:#16836c!important;font-weight:600;white-space:nowrap}.accounting-tabs{display:flex;align-items:center;gap:24px;overflow-x:auto;border-bottom:1px solid #dbe2e9}.accounting-tabs>button{display:flex;align-items:center;gap:8px;padding:12px 0;border:0;border-bottom:2px solid transparent;background:transparent;color:#6b788b;font-size:13px;font-weight:500;white-space:nowrap}.accounting-tabs>button:hover:not(:disabled){color:#243146}.accounting-tabs>button[aria-selected="true"]{color:#07886d;border-bottom-color:#07886d}.accounting-tabs .accounting-reload{margin-left:auto;font-size:11px;color:#728094}.accounting-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);gap:18px;align-items:start}.accounting-main-card{min-width:0}.accounting-action-card{padding:22px;position:sticky;top:20px}.accounting-action-card h3{font-size:16px;margin:14px 0 6px}.accounting-action-card>p{font-size:11px;line-height:1.7;color:#8491a1;margin:0 0 20px}.accounting-action-card form{display:grid;gap:14px}.accounting-action-card .field{margin:0}.accounting-submit{width:100%;justify-content:center;margin-top:4px}.action-icon,.period-icon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid #dcece6;border-radius:9px;background:#eef8f4;color:#19826d}.action-icon.compact{width:32px;height:32px}.action-icon.warning{background:#fff8e9;border-color:#f2dfb6;color:#9b7420}.account-code,.journal-id{display:inline-flex;padding:4px 7px;border-radius:5px;background:#f1f4f7;color:#526176;font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace}.account-kind,.side-badge{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:600}.account-kind.asset{background:#e8f5f0;color:#147863}.account-kind.liability{background:#fff3e5;color:#9b6422}.account-kind.equity{background:#f1edfb;color:#735ca6}.account-kind.revenue{background:#eaf2fb;color:#3d70a3}.account-kind.expense{background:#fdeef0;color:#a4515d}.mapping-row{padding:18px 24px;border-top:1px solid #edf1f4}.mapping-row:first-child{border-top:0}.mapping-title{display:flex;align-items:center;gap:12px}.mapping-title strong{display:block;font-size:13px}.mapping-title small{display:block;color:#929dad;font-size:10px;margin-top:3px}.mapping-flow{display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:8px 12px;align-items:center;margin:14px 0 0 44px;padding:12px;background:#f8fafb;border-radius:8px;font-size:11px}.mapping-flow small{color:#8794a5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.side-badge.debit{background:#e8f5f0;color:#147863}.side-badge.credit{background:#eaf2fb;color:#3d70a3}.form-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.report-stack{display:grid;gap:18px}.report-filter-card{padding:22px 24px}.report-filter-card>div h2{font-size:16px;margin:0 0 5px}.report-filter-card>div p{font-size:11px;color:#8895a5;margin:0}.report-filter-card form{display:flex;align-items:end;gap:14px;margin-top:20px}.report-filters{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:12px;flex:1}.report-filters .field{margin:0}.report-filter-card form>.button{flex-shrink:0;margin-bottom:10px}.report-empty{padding-block:44px}.financial-table .number-column{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.financial-table tfoot th{font-size:11px;color:#354458;background:#f3f7f6;border-top:2px solid #dce9e4}.ledger-table{max-height:420px}.opening-row{background:#fafbfc;color:#687689}.period-list article{display:flex;align-items:center;gap:13px;padding:16px 24px;border-top:1px solid #edf1f4}.period-list article:first-child{border-top:0}.period-list article>div{display:grid;gap:4px;flex:1}.period-list strong{font-size:13px}.period-list small{font-size:10px;color:#8b98a7}.period-icon{width:34px;height:34px}.period-action>p{color:#776f62}.accounting-page [role="tabpanel"]:focus{outline:none}
@media(max-width:1050px){.accounting-overview{align-items:flex-start;flex-direction:column}.accounting-summary{width:100%;flex-wrap:wrap}.accounting-layout{grid-template-columns:1fr}.accounting-action-card{position:static}.report-filter-card form{align-items:stretch;flex-direction:column}.report-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.report-filter-card form>.button{align-self:flex-start;margin-bottom:0}}
@media(max-width:650px){.accounting-overview{padding:18px}.accounting-summary{gap:16px}.accounting-summary>div{min-width:48px}.currency-badge{width:100%;text-align:center}.accounting-tabs{gap:18px}.accounting-tabs .accounting-reload{margin-left:0}.accounting-reload span{display:none}.report-filters,.form-pair{grid-template-columns:1fr}.mapping-flow{grid-template-columns:50px minmax(0,1fr);margin-left:0}.mapping-flow small{grid-column:2}.accounting-action-card,.report-filter-card{padding:18px}.panel-heading{align-items:flex-start}.financial-table{min-width:620px}}
</style>
