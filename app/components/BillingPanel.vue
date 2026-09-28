<script setup lang="ts">
// [MBX-8][CASH-001][BILL-001/002/003][PAY-001/002/003] Cash accounts, AR/AP documents,
// receivables aging, payments and allocation. Business rules live in server/core/billing.
type CashAccount = { id: string; unitId: string; code: string; name: string; kind: string; ledgerAccountId: string; active: boolean }
type LedgerAccount = { id: string; code: string; name: string; kind: string }
type Document = { id: string; type: string; number: string; unitId: string; partyId: string; bookDate: string; dueDate: string; amount: string; outstanding: string; status: string }
type Payment = { id: string; direction: string; number: string; unitId: string; partyId: string; cashAccountId: string; bookDate: string; amount: string; allocated: string; status: string }
type Party = { id: string; name: string; roles: { role: string; unitId: string | null }[] }
type Unit = { id: string; name: string }
type Aging = { asOf: string; type: string; buckets: Record<string, string>; rows: { party_id: string | null; party_name: string | null; bucket: string; documents: number; outstanding: string }[] }

const props = defineProps<{ tenantId: string; canManageCash: boolean; canPost: boolean; canViewAll: boolean; assignedUnitIds: string[] }>()
const root = computed(() => `/api/tenants/${props.tenantId}/billing`)
const allTabs = ['accounts', 'documents', 'aging', 'payments'] as const
type BillingTab = (typeof allTabs)[number]
const tabs = computed<readonly BillingTab[]>(() => props.canManageCash ? allTabs : allTabs.filter(tab => tab !== 'accounts'))
const activeTab = ref<BillingTab>('documents'), tabId = useId()
const tabLabels = { accounts: 'Kas & Bank', documents: 'Tagihan', aging: 'Umur Piutang', payments: 'Pembayaran' }
const bucketLabels: Record<string, string> = { current: 'Belum jatuh tempo', '1-30': '1–30 hari', '31-60': '31–60 hari', '61-90': '61–90 hari', '90+': 'Lebih dari 90 hari' }

const units = ref<Unit[]>([]), parties = ref<Party[]>([]), ledger = ref<LedgerAccount[]>([])
const accounts = ref<CashAccount[]>([]), documents = ref<Document[]>([]), payments = ref<Payment[]>([])
const aging = ref<Aging | null>(null)
const busy = ref(false), message = ref(''), success = ref(false)
const filterUnit = ref(''), filterDocumentType = ref(''), filterDocumentStatus = ref('')
const asOf = ref(new Date().toISOString().slice(0, 10)), agingType = ref<'invoice' | 'bill'>('invoice')

const accountForm = ref({ unitId: '', code: '', name: '', kind: 'cash', ledgerAccountId: '' })
const documentForm = ref({ type: 'invoice', unitId: '', partyId: '', bookDate: new Date().toISOString().slice(0, 10), dueDate: '', amount: '' })
const paymentForm = ref({ direction: 'in', unitId: '', partyId: '', cashAccountId: '', bookDate: new Date().toISOString().slice(0, 10), amount: '' })
const allocationForm = ref({ paymentId: '', documentId: '', amount: '' })
const voidForm = ref({ documentId: '', reason: '' })

const idr = (value: string) => new Intl.NumberFormat('id-ID').format(BigInt(value || '0'))
const unitName = (id: string) => units.value.find(unit => unit.id === id)?.name || 'Unit'
const partyName = (id: string) => parties.value.find(party => party.id === id)?.name || 'Mitra'
const accountName = (id: string) => accounts.value.find(account => account.id === id)
const typeLabels: Record<string, string> = { invoice: 'Faktur (AR)', bill: 'Tagihan masuk (AP)' }
const statusLabels: Record<string, string> = { open: 'Terbuka', paid: 'Lunas', void: 'Dibatalkan' }
const documentTypes = computed(() => documentForm.value.type === 'invoice' ? ['customer'] : ['vendor'])
const documentParties = computed(() => parties.value.filter(party => party.roles.some(role => documentTypes.value.includes(role.role) && (!role.unitId || role.unitId === documentForm.value.unitId))))
const paymentParties = computed(() => parties.value.filter(party => party.roles.some(role => (paymentForm.value.direction === 'in' ? 'customer' : 'vendor') === role.role && (!role.unitId || role.unitId === paymentForm.value.unitId))))
const unitCashAccounts = computed(() => accounts.value.filter(account => account.active && account.unitId === paymentForm.value.unitId))
const openDocuments = computed(() => documents.value.filter(document => document.status === 'open' && document.partyId === payments.value.find(payment => payment.id === allocationForm.value.paymentId)?.partyId))
const outstandingTotal = computed(() => documents.value.filter(document => document.status === 'open').reduce((sum, document) => sum + BigInt(document.outstanding), 0n).toString())
const unallocatedTotal = computed(() => payments.value.reduce((sum, payment) => sum + (BigInt(payment.amount) - BigInt(payment.allocated)), 0n).toString())
const agingTotal = computed(() => Object.values(aging.value?.buckets || {}).reduce((sum, value) => sum + BigInt(value), 0n).toString())

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
    const scoped = filterUnit.value ? { unitId: filterUnit.value } : {}
    const [accountRows, paymentRows] = await Promise.all([
      $fetch<CashAccount[]>(root.value + '/cash-accounts', { query: scoped }),
      $fetch<Payment[]>(root.value + '/payments', { query: scoped }),
    ])
    accounts.value = accountRows; payments.value = paymentRows
    documents.value = await $fetch<Document[]>(root.value + '/documents', { query: { ...scoped, ...(filterDocumentType.value ? { type: filterDocumentType.value } : {}), ...(filterDocumentStatus.value ? { status: filterDocumentStatus.value } : {}) } })
    const all: Unit[] = []
    for (let page = 1; page <= 1000; page++) {
      const batch = await $fetch<Unit[]>(`/api/tenants/${props.tenantId}/units`, { query: { page } }); all.push(...batch)
      if (batch.length < 50) break
    }
    units.value = all.filter(unit => props.canViewAll || props.assignedUnitIds.includes(unit.id))
    const scopedParties: Party[] = []
    for (let page = 1; page <= 1000; page++) {
      const batch = await $fetch<Party[]>('/api/tenants/' + props.tenantId + '/parties', { query: { page } }); scopedParties.push(...batch)
      if (batch.length < 50) break
    }
    parties.value = scopedParties
    if (!accountForm.value.unitId) accountForm.value.unitId = units.value[0]?.id || ''
    if (!documentForm.value.unitId) documentForm.value.unitId = units.value[0]?.id || ''
    if (!paymentForm.value.unitId) paymentForm.value.unitId = units.value[0]?.id || ''
    if (props.canManageCash) ledger.value = await $fetch<LedgerAccount[]>(`/api/tenants/${props.tenantId}/accounting/accounts`)
  } catch { message.value = 'Data kas dan tagihan belum dapat dimuat.'; success.value = false }
  finally { busy.value = false }
}

async function save(task: () => Promise<unknown>, confirmation: string) {
  busy.value = true; message.value = ''; success.value = false
  try { await task(); await load(); message.value = confirmation; success.value = true }
  catch { message.value = 'Perubahan belum berhasil. Periksa data, status dokumen, dan akses Anda.' }
  finally { busy.value = false }
}

async function addAccount() {
  const { unitId, code, name, kind, ledgerAccountId } = accountForm.value
  await save(() => $fetch(root.value + '/cash-accounts', { method: 'POST', body: { unitId, code, name, kind, ledgerAccountId } }), 'Akun kas berhasil dibuat.')
  if (success.value) accountForm.value = { ...accountForm.value, code: '', name: '', ledgerAccountId: '' }
}
async function addDocument() {
  const { type, unitId, partyId, bookDate, dueDate, amount } = documentForm.value
  await save(() => $fetch(root.value + '/documents', { method: 'POST', body: { type, unitId, locationId: null, partyId, bookDate, dueDate, amount, commandId: crypto.randomUUID() } }), 'Dokumen berhasil dicatat.')
  if (success.value) documentForm.value = { ...documentForm.value, partyId: '', amount: '', dueDate: '' }
}
async function addPayment() {
  const { direction, unitId, partyId, cashAccountId, bookDate, amount } = paymentForm.value
  await save(() => $fetch(root.value + '/payments', { method: 'POST', body: { direction, unitId, locationId: null, partyId, cashAccountId, bookDate, amount, commandId: crypto.randomUUID() } }), 'Pembayaran berhasil dicatat.')
  if (success.value) paymentForm.value = { ...paymentForm.value, partyId: '', amount: '' }
}
async function allocate() {
  await save(() => $fetch(root.value + '/allocations', { method: 'POST', body: { ...allocationForm.value } }), 'Pembayaran berhasil dialokasikan.')
  if (success.value) allocationForm.value = { paymentId: '', documentId: '', amount: '' }
}
async function voidDocument() {
  await save(() => $fetch(root.value + '/documents/void', { method: 'POST', body: { documentId: voidForm.value.documentId, reason: voidForm.value.reason, reference: null } }), 'Dokumen berhasil dibatalkan.')
  if (success.value) voidForm.value = { documentId: '', reason: '' }
}
async function loadAging() {
  busy.value = true; message.value = ''
  try { aging.value = await $fetch<Aging>(root.value + '/aging', { query: { asOf: asOf.value, type: agingType.value, ...(filterUnit.value ? { unitId: filterUnit.value } : {}) } }) }
  catch { message.value = 'Laporan umur piutang belum dapat dimuat.'; success.value = false }
  finally { busy.value = false }
}
async function selectPayment(payment: Payment) {
  allocationForm.value.paymentId = payment.id
  allocationForm.value.documentId = ''
  allocationForm.value.amount = (BigInt(payment.amount) - BigInt(payment.allocated)).toString()
}
async function selectDocument(document: Document) {
  if (!allocationForm.value.paymentId) { voidForm.value.documentId = document.id; return }
  allocationForm.value.documentId = document.id
}
onMounted(load)
</script>

<template>
  <section class="billing-page" :aria-busy="busy">
    <div class="billing-overview">
      <div><span class="eyebrow muted">ALUR UANG BUMDES</span><h2>Kas &amp; Tagihan</h2><p>Catat penerimaan dan pengeluaran kas, pantau piutang usaha, dan alokasikan pembayaran ke dokumen.</p></div>
      <div class="billing-summary" aria-label="Ringkasan kas dan tagihan"><div><strong>{{ accounts.length }}</strong><span>Akun kas</span></div><div><strong>Rp {{ idr(outstandingTotal) }}</strong><span>Outstanding</span></div><div><strong>Rp {{ idr(unallocatedTotal) }}</strong><span>Belum dialokasikan</span></div><span class="currency-badge">IDR · Rupiah bulat</span></div>
    </div>
    <p v-if="message" :class="['notice', success ? 'success' : 'error']" :role="success ? 'status' : 'alert'">{{ message }}</p>
    <div class="billing-tabs" role="tablist" aria-label="Bagian kas dan tagihan">
      <button v-for="tab in tabs" :id="`${tabId}-${tab}-tab`" :key="tab" type="button" role="tab" :aria-selected="activeTab === tab" :aria-controls="`${tabId}-${tab}-panel`" :tabindex="activeTab === tab ? 0 : -1" @click="activeTab = tab" @keydown="navigateTabs"><AppIcon :name="tab === 'accounts' ? 'building' : tab === 'documents' ? 'layers' : tab === 'aging' ? 'clock' : 'check'" :size="17" />{{ tabLabels[tab] }}</button>
      <button class="billing-reload" type="button" :disabled="busy" aria-label="Muat ulang data kas dan tagihan" @click="load"><AppIcon name="refresh" :size="16" /><span>Muat ulang</span></button>
    </div>
    <div class="billing-filter">
      <label class="field">Unit Usaha<select v-model="filterUnit" :disabled="busy" @change="load"><option v-if="canViewAll" value="">Semua Unit</option><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label>
      <label class="field">Jenis dokumen<select v-model="filterDocumentType" :disabled="busy" @change="load"><option value="">Semua jenis</option><option value="invoice">Faktur (AR)</option><option value="bill">Tagihan masuk (AP)</option></select></label>
      <label class="field">Status<select v-model="filterDocumentStatus" :disabled="busy" @change="load"><option value="">Semua status</option><option value="open">Terbuka</option><option value="paid">Lunas</option><option value="void">Dibatalkan</option></select></label>
    </div>

    <div v-show="activeTab === 'accounts'" :id="`${tabId}-accounts-panel`" class="billing-layout" role="tabpanel" :aria-labelledby="`${tabId}-accounts-tab`" tabindex="0">
      <section class="panel billing-main-card"><div class="panel-heading"><div><h2>Kas &amp; bank per Unit</h2><p>Setiap akun kas menunjuk satu akun buku besar.</p></div><span class="count-badge">{{ accounts.length }} akun</span></div><div v-if="!accounts.length" class="empty-state"><h3>Belum ada akun kas</h3><p>Tambahkan akun kas atau bank untuk mulai mencatat pembayaran.</p></div><div v-else class="table-scroll"><table><thead><tr><th>Kode</th><th>Nama</th><th>Jenis</th><th>Unit</th><th>Akun buku besar</th><th>Status</th></tr></thead><tbody><tr v-for="account in accounts" :key="account.id"><td><span class="account-code">{{ account.code }}</span></td><td><strong>{{ account.name }}</strong></td><td><span :class="['account-kind', account.kind]">{{ account.kind === 'bank' ? 'Bank' : 'Kas' }}</span></td><td>{{ unitName(account.unitId) }}</td><td>{{ accountName(account.ledgerAccountId)?.code }} · {{ accountName(account.ledgerAccountId)?.name }}</td><td><span :class="['status-pill', account.active ? 'active' : 'inactive']">{{ account.active ? 'Aktif' : 'Nonaktif' }}</span></td></tr></tbody></table></div></section>
      <aside v-if="canManageCash" class="panel billing-action-card"><span class="action-icon"><AppIcon name="plus" :size="18" /></span><h3>Tambah akun kas</h3><p>Akun kas dimiliki satu Unit Usaha dan dipetakan ke akun buku besar.</p><form @submit.prevent="addAccount"><label class="field">Unit Usaha<select v-model="accountForm.unitId" required :disabled="busy"><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label><label class="field">Kode<input v-model="accountForm.code" required maxlength="32" placeholder="Contoh: KAS-01" :disabled="busy"></label><label class="field">Nama<input v-model="accountForm.name" required maxlength="160" placeholder="Contoh: Kas Unit Toko" :disabled="busy"></label><label class="field">Jenis<select v-model="accountForm.kind" :disabled="busy"><option value="cash">Kas</option><option value="bank">Bank</option></select></label><label class="field">Akun buku besar<select v-model="accountForm.ledgerAccountId" required :disabled="busy"><option value="">Pilih akun</option><option v-for="item in ledger" :key="item.id" :value="item.id">{{ item.code }} · {{ item.name }}</option></select></label><button class="button primary billing-submit" :disabled="busy || !ledger.length">{{ busy ? 'Menyimpan…' : 'Simpan akun kas' }}</button></form></aside>
    </div>

    <div v-show="activeTab === 'documents'" :id="`${tabId}-documents-panel`" class="billing-layout" role="tabpanel" :aria-labelledby="`${tabId}-documents-tab`" tabindex="0">
      <section class="panel billing-main-card"><div class="panel-heading"><div><h2>Dokumen tagihan</h2><p>Faktur menambah piutang; tagihan masuk menambah utang pada Party yang sama.</p></div><span class="count-badge">{{ documents.length }} dokumen</span></div><div v-if="!documents.length" class="empty-state"><h3>Belum ada dokumen</h3><p>Catat faktur atau tagihan masuk pada panel di samping.</p></div><div v-else class="table-scroll"><table><thead><tr><th>Nomor</th><th>Jenis</th><th>Party</th><th>Jatuh tempo</th><th class="number-column">Nilai (Rp)</th><th class="number-column">Outstanding (Rp)</th><th>Status</th><th v-if="canPost">Tindakan</th></tr></thead><tbody><tr v-for="document in documents" :key="document.id"><td><span class="journal-id" :title="document.id">{{ document.number }}</span></td><td>{{ typeLabels[document.type] || document.type }}</td><td><strong>{{ partyName(document.partyId) }}</strong><br><small>{{ unitName(document.unitId) }}</small></td><td>{{ document.dueDate }}</td><td class="number-column">{{ idr(document.amount) }}</td><td class="number-column"><strong>{{ idr(document.outstanding) }}</strong></td><td><span :class="['status-pill', document.status === 'open' ? 'active' : 'inactive']">{{ statusLabels[document.status] || document.status }}</span></td><td v-if="canPost"><button type="button" class="link-button" :disabled="busy || document.status === 'void'" @click="selectDocument(document)">{{ document.status === 'void' ? '—' : 'Batalkan' }}</button></td></tr></tbody></table></div></section>
      <aside v-if="canPost" class="billing-actions">
        <div class="panel billing-action-card"><span class="action-icon"><AppIcon name="layers" :size="18" /></span><h3>Catat dokumen</h3><p>Nominasi selalu milik satu Party aktif dengan peran sesuai jenis dokumen.</p><form @submit.prevent="addDocument"><div class="form-pair"><label class="field">Jenis dokumen<select v-model="documentForm.type" :disabled="busy" @change="documentForm.partyId = ''"><option value="invoice">Faktur (AR)</option><option value="bill">Tagihan masuk (AP)</option></select></label><label class="field">Unit Usaha<select v-model="documentForm.unitId" required :disabled="busy" @change="documentForm.partyId = ''"><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label></div><label class="field">Party<select v-model="documentForm.partyId" required :disabled="busy || !documentParties.length"><option value="">{{ documentParties.length ? 'Pilih Party' : 'Party belum tersedia untuk Unit ini' }}</option><option v-for="party in documentParties" :key="party.id" :value="party.id">{{ party.name }}</option></select></label><div class="form-pair"><label class="field">Tanggal buku<input v-model="documentForm.bookDate" type="date" required :disabled="busy"></label><label class="field">Jatuh tempo<input v-model="documentForm.dueDate" type="date" required :disabled="busy"></label></div><label class="field">Nilai (Rp)<input v-model="documentForm.amount" required inputmode="numeric" pattern="[0-9]+" placeholder="Contoh: 1500000" :disabled="busy"></label><button class="button primary billing-submit" :disabled="busy || !documentParties.length">{{ busy ? 'Menyimpan…' : 'Simpan dokumen' }}</button></form></div>
        <div class="panel billing-action-card"><span class="action-icon warning"><AppIcon name="close" :size="18" /></span><h3>Batalkan dokumen</h3><p>Pembatalan hanya berlaku bila dokumen belum menerima alokasi pembayaran.</p><form @submit.prevent="voidDocument"><label class="field">Dokumen<select v-model="voidForm.documentId" required :disabled="busy"><option value="">Pilih dokumen terbuka</option><option v-for="document in documents.filter(d => d.status === 'open')" :key="document.id" :value="document.id">{{ document.number }} · {{ idr(document.outstanding) }}</option></select></label><label class="field">Alasan<input v-model="voidForm.reason" required maxlength="500" placeholder="Contoh: salah input" :disabled="busy"></label><button class="button primary billing-submit" :disabled="busy || !voidForm.documentId">{{ busy ? 'Memproses…' : 'Batalkan dokumen' }}</button></form></div>
      </aside>
    </div>

    <div v-show="activeTab === 'aging'" :id="`${tabId}-aging-panel`" class="billing-stack" role="tabpanel" :aria-labelledby="`${tabId}-aging-tab`" tabindex="0">
      <section class="panel billing-filter-card"><div><h2>Umur piutang &amp; utang</h2><p>Bucket dihitung dari selisih tanggal jatuh tempo terhadap tanggal acuan.</p></div><form @submit.prevent="loadAging"><div class="report-filters"><label class="field">Jenis<select v-model="agingType" :disabled="busy"><option value="invoice">Piutang (AR)</option><option value="bill">Utang (AP)</option></select></label><label class="field">Tanggal acuan<input v-model="asOf" type="date" required :disabled="busy"></label></div><button class="button primary" :disabled="busy"><AppIcon name="search" :size="16" />{{ busy ? 'Menyusun…' : 'Tampilkan' }}</button></form></section>
      <section class="panel billing-main-card"><div class="panel-heading"><div><h2>Ringkasan bucket</h2><p v-if="aging">Per {{ aging.asOf }} · {{ aging.type === 'invoice' ? 'Piutang' : 'Utang' }}</p></div><span v-if="aging" class="count-badge">Total Rp {{ idr(agingTotal) }}</span></div><div v-if="!aging" class="empty-state"><h3>Belum ada hasil</h3><p>Tentukan tanggal acuan lalu pilih “Tampilkan”.</p></div><div v-else class="bucket-grid"><article v-for="(value, bucket) in aging.buckets" :key="bucket"><span>{{ bucketLabels[bucket] || bucket }}</span><strong>Rp {{ idr(value) }}</strong></article></div><div v-if="aging?.rows.length" class="table-scroll"><table><thead><tr><th>Party</th><th>Bucket</th><th class="number-column">Dokumen</th><th class="number-column">Outstanding (Rp)</th></tr></thead><tbody><tr v-for="row in aging.rows" :key="`${row.party_id}-${row.bucket}`"><td><strong>{{ row.party_name || 'Tanpa nama' }}</strong></td><td>{{ bucketLabels[row.bucket] || row.bucket }}</td><td class="number-column">{{ row.documents }}</td><td class="number-column">{{ idr(row.outstanding) }}</td></tr></tbody></table></div></section>
    </div>

    <div v-show="activeTab === 'payments'" :id="`${tabId}-payments-panel`" class="billing-layout" role="tabpanel" :aria-labelledby="`${tabId}-payments-tab`" tabindex="0">
      <section class="panel billing-main-card"><div class="panel-heading"><div><h2>Pembayaran</h2><p>Pilih pembayaran lalu dokumen untuk mengalokasikan dana yang belum tersettel.</p></div><span class="count-badge">{{ payments.length }} pembayaran</span></div><div v-if="!payments.length" class="empty-state"><h3>Belum ada pembayaran</h3><p>Catat penerimaan atau pengeluaran kas terlebih dahulu.</p></div><div v-else class="table-scroll"><table><thead><tr><th>Nomor</th><th>Arah</th><th>Party</th><th>Kas</th><th class="number-column">Nilai (Rp)</th><th class="number-column">Tersisa (Rp)</th></tr></thead><tbody><tr v-for="payment in payments" :key="payment.id" :class="{ selected: allocationForm.paymentId === payment.id }" @click="selectPayment(payment)"><td><span class="journal-id" :title="payment.id">{{ payment.number }}</span></td><td><span :class="['side-badge', payment.direction === 'in' ? 'debit' : 'credit']">{{ payment.direction === 'in' ? 'Masuk' : 'Keluar' }}</span></td><td><strong>{{ partyName(payment.partyId) }}</strong></td><td>{{ accountName(payment.cashAccountId)?.name || '—' }}</td><td class="number-column">{{ idr(payment.amount) }}</td><td class="number-column"><strong>{{ idr((BigInt(payment.amount) - BigInt(payment.allocated)).toString()) }}</strong></td></tr></tbody></table></div><p v-if="allocationForm.paymentId" class="hint">Dokumen terbuka dengan Party yang sama: {{ openDocuments.length }}</p></section>
      <aside v-if="canPost" class="billing-actions">
        <div class="panel billing-action-card"><span class="action-icon"><AppIcon name="plus" :size="18" /></span><h3>Catat pembayaran</h3><p>Pembayaran selalu menunjuk satu Party aktif dan satu akun kas Unit.</p><form @submit.prevent="addPayment"><div class="form-pair"><label class="field">Arah<select v-model="paymentForm.direction" :disabled="busy" @change="paymentForm.partyId = ''"><option value="in">Masuk (dari customer)</option><option value="out">Keluar (ke vendor)</option></select></label><label class="field">Unit Usaha<select v-model="paymentForm.unitId" required :disabled="busy" @change="paymentForm.partyId = ''; paymentForm.cashAccountId = ''"><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label></div><label class="field">Party<select v-model="paymentForm.partyId" required :disabled="busy || !paymentParties.length"><option value="">{{ paymentParties.length ? 'Pilih Party' : 'Party belum tersedia untuk Unit ini' }}</option><option v-for="party in paymentParties" :key="party.id" :value="party.id">{{ party.name }}</option></select></label><div class="form-pair"><label class="field">Akun kas<select v-model="paymentForm.cashAccountId" required :disabled="busy || !unitCashAccounts.length"><option value="">{{ unitCashAccounts.length ? 'Pilih akun kas' : 'Belum ada akun kas aktif' }}</option><option v-for="account in unitCashAccounts" :key="account.id" :value="account.id">{{ account.code }} · {{ account.name }}</option></select></label><label class="field">Tanggal buku<input v-model="paymentForm.bookDate" type="date" required :disabled="busy"></label></div><label class="field">Nilai (Rp)<input v-model="paymentForm.amount" required inputmode="numeric" pattern="[0-9]+" placeholder="Contoh: 500000" :disabled="busy"></label><button class="button primary billing-submit" :disabled="busy || !paymentParties.length || !unitCashAccounts.length">{{ busy ? 'Menyimpan…' : 'Simpan pembayaran' }}</button></form></div>
        <div class="panel billing-action-card"><span class="action-icon"><AppIcon name="arrow" :size="18" /></span><h3>Alokasikan pembayaran</h3><p>Alokasi tidak boleh melebihi sisa pembayaran atau outstanding dokumen.</p><form @submit.prevent="allocate"><label class="field">Pembayaran<select v-model="allocationForm.paymentId" required :disabled="busy" @change="allocationForm.documentId = ''"><option value="">Pilih pembayaran</option><option v-for="payment in payments.filter(p => BigInt(p.amount) - BigInt(p.allocated) > 0n)" :key="payment.id" :value="payment.id">{{ payment.number }} · sisa {{ idr((BigInt(payment.amount) - BigInt(payment.allocated)).toString()) }}</option></select></label><label class="field">Dokumen<select v-model="allocationForm.documentId" required :disabled="busy || !allocationForm.paymentId"><option value="">{{ allocationForm.paymentId ? (openDocuments.length ? 'Pilih dokumen terbuka' : 'Tidak ada dokumen terbuka') : 'Pilih pembayaran dahulu' }}</option><option v-for="document in openDocuments" :key="document.id" :value="document.id">{{ document.number }} · {{ idr(document.outstanding) }}</option></select></label><label class="field">Nominal alokasi (Rp)<input v-model="allocationForm.amount" required inputmode="numeric" pattern="[0-9]+" :disabled="busy" placeholder="Contoh: 500000"></label><button class="button primary billing-submit" :disabled="busy || !allocationForm.paymentId || !allocationForm.documentId">{{ busy ? 'Mengalokasikan…' : 'Alokasikan' }}</button></form></div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.billing-page{display:grid;gap:18px}.billing-overview{display:flex;align-items:center;justify-content:space-between;gap:28px;padding:22px 24px;border:1px solid #e2e9ee;border-radius:13px;background:linear-gradient(120deg,#fff 62%,#f1f8f5)}.billing-overview h2{font-size:21px;margin:5px 0 6px}.billing-overview p{margin:0;color:#7d8998;font-size:12px}.billing-summary{display:flex;align-items:center;gap:22px;flex-shrink:0}.billing-summary>div{display:grid;gap:2px;min-width:58px}.billing-summary strong{font-size:17px;color:#243146}.billing-summary span{font-size:10px;color:#8d99a8}.currency-badge{padding:7px 10px;border-radius:999px;background:#e4f5ef;color:#16836c!important;font-weight:600;white-space:nowrap}.billing-tabs{display:flex;align-items:center;gap:24px;overflow-x:auto;border-bottom:1px solid #dbe2e9}.billing-tabs>button{display:flex;align-items:center;gap:8px;padding:12px 0;border:0;border-bottom:2px solid transparent;background:transparent;color:#6b788b;font-size:13px;font-weight:500;white-space:nowrap}.billing-tabs>button:hover:not(:disabled){color:#243146}.billing-tabs>button[aria-selected="true"]{color:#07886d;border-bottom-color:#07886d}.billing-tabs .billing-reload{margin-left:auto;font-size:11px;color:#728094}.billing-filter{display:grid;grid-template-columns:repeat(3,minmax(150px,220px));gap:12px}.billing-filter .field{margin:0}.billing-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);gap:18px;align-items:start}.billing-main-card{min-width:0}.billing-actions{display:grid;gap:18px}.billing-action-card{padding:22px}.billing-action-card h3{font-size:16px;margin:14px 0 6px}.billing-action-card>p{font-size:11px;line-height:1.7;color:#8491a1;margin:0 0 20px}.billing-action-card form{display:grid;gap:14px}.billing-action-card .field{margin:0}.billing-submit{width:100%;justify-content:center;margin-top:4px}.action-icon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid #dcece6;border-radius:9px;background:#eef8f4;color:#19826d}.action-icon.warning{background:#fff8e9;border-color:#f2dfb6;color:#9b7420}.account-code,.journal-id{display:inline-flex;padding:4px 7px;border-radius:5px;background:#f1f4f7;color:#526176;font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace}.account-kind{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:600;background:#e8f5f0;color:#147863}.side-badge{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:600}.side-badge.debit{background:#e8f5f0;color:#147863}.side-badge.credit{background:#fdeef0;color:#a4515d}.form-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}.billing-stack{display:grid;gap:18px}.billing-filter-card{padding:22px 24px}.billing-filter-card>div h2{font-size:16px;margin:0 0 5px}.billing-filter-card>div p{font-size:11px;color:#8895a5;margin:0}.billing-filter-card form{display:flex;align-items:flex-end;gap:14px;margin-top:20px}.report-filters{display:grid;grid-template-columns:repeat(2,minmax(150px,220px));gap:12px;flex:1}.report-filters .field{margin:0}.billing-filter-card form>.button{flex-shrink:0;min-height:46px}.bucket-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;padding:20px 24px;border-bottom:1px solid #edf1f4}.bucket-grid article{display:grid;gap:5px;padding:13px;border-radius:9px;background:#f7faf9}.bucket-grid span{font-size:10px;color:#8b98a7}.bucket-grid strong{font-size:14px;color:#243146}.table-scroll{overflow-x:auto}.billing-main-card table{width:100%;border-collapse:collapse;font-size:12px}.billing-main-card th{position:sticky;top:0;z-index:1;text-align:left;padding:12px 16px;background:#f8fafb;border-bottom:1px solid #e6ecf0;color:#78859a;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}.billing-main-card td{padding:14px 16px;border-top:1px solid #edf1f4;color:#3a4759;vertical-align:middle}.billing-main-card tbody tr:hover{background:#fbfcfc}.billing-main-card tr.selected{background:#eff8f4}.number-column{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.link-button{border:0;background:transparent;color:#a4515d;font-size:11px;font-weight:600}.link-button:hover:not(:disabled){text-decoration:underline}.hint{margin:14px 24px 20px;font-size:11px;color:#7d8998}.billing-page [role="tabpanel"]:focus{outline:none}
@media(max-width:1050px){.billing-overview{align-items:flex-start;flex-direction:column}.billing-summary{width:100%;flex-wrap:wrap}.billing-layout{grid-template-columns:1fr}.billing-filter{grid-template-columns:repeat(2,minmax(0,1fr))}.bucket-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.billing-filter-card form{align-items:stretch;flex-direction:column}.billing-filter-card form>.button{align-self:flex-start}}
@media(max-width:650px){.billing-overview{padding:18px}.billing-summary{gap:16px}.currency-badge{width:100%;text-align:center}.billing-tabs{gap:18px}.billing-tabs .billing-reload{margin-left:0}.billing-reload span{display:none}.billing-filter,.form-pair{grid-template-columns:1fr}.bucket-grid{grid-template-columns:1fr;padding:16px}.billing-action-card,.billing-filter-card{padding:18px}.billing-main-card table{min-width:680px}}
</style>
