<script setup lang="ts">
// [MBX-9][PROC-001/002/003] Procurement source documents: item/service master data, Purchase
// Request, RFQ and per-vendor quotations. All business rules live in server/core/procurement.
// This slice intentionally stops before approval: a PR ends at "diajukan", and nothing here
// creates a journal, because procurement posts nothing until Vendor Bill (MBX-11).
type Item = { id: string; unitId: string | null; code: string; name: string; kind: string; uom: string; active: boolean }
type PurchaseRequest = { id: string; number: string; unitId: string; bookDate: string; justification: string; status: string; requestedBy: string; submittedBy: string | null; lines: { itemId: string; quantity: string }[] }
type Rfq = { id: string; number: string; purchaseRequestId: string; unitId: string; bookDate: string; note: string | null; vendorIds: string[] }
type Quotation = { id: string; number: string; rfqId: string; partyId: string; bookDate: string; validUntil: string | null; paymentTerm: string | null; deliveryDays: number | null; revision: number; supersedesId: string | null; lines: { itemId: string; quantity: string; unitPrice: string }[]; total: string }
type Party = { id: string; name: string; roles: { role: string; unitId: string | null }[] }
type Unit = { id: string; name: string }
// [MBX-10][PROC-004] Comparison is a read model: a vendor's effective quotation, whether it was
// invited, and its prior price for the same item when one exists.
type Offer = { itemId: string; quantity: string | null; unitPrice: string | null; amount: string | null; mixedRate: boolean; historicalUnitPrice: string | null; historicalQuotationNumber: string | null; historicalBookDate: string | null; priceDelta: string | null; priceDeltaPct: number | null }
type ComparisonVendor = { partyId: string; name: string; invited: boolean; total: string | null; itemsPriced: number; itemsMissing: number; itemsMixed: number; quotation: { id: string; number: string; revision: number; bookDate: string; validUntil: string | null; paymentTerm: string | null; deliveryDays: number | null; revisionCount: number } | null; offers: Offer[] }
type Comparison = {
  rfq: { id: string; number: string; unitId: string; bookDate: string; note: string | null }
  purchaseRequest: { id: string; number: string; justification: string; status: string } | null
  items: { itemId: string; code: string; name: string; uom: string; cheapestUnitPrice: string | null; cheapestPartyIds: string[] }[]
  vendors: ComparisonVendor[]
  summary: { vendors: number; quoted: number; revisions: number; lowestTotal: string | null; lowestTotalPartyIds: string[]; hasHistoricalPrices: boolean; historicalAnchorDate: string }
}

const props = defineProps<{ tenantId: string; canCreateRequest: boolean; canManageRfq: boolean; canQuote: boolean; canManageItems: boolean; canViewAll: boolean; assignedUnitIds: string[] }>()
const root = computed(() => `/api/tenants/${props.tenantId}/procurement`)
const allTabs = ['requests', 'rfq', 'quotations', 'comparison', 'items'] as const
type Tab = (typeof allTabs)[number]
const tabs = computed<readonly Tab[]>(() => props.canManageItems ? allTabs : allTabs.filter(tab => tab !== 'items'))
const tabLabels = { requests: 'Permintaan Pembelian', rfq: 'RFQ Vendor', quotations: 'Penawaran', comparison: 'Perbandingan Vendor', items: 'Item & Jasa' }
const activeTab = ref<Tab>('requests'), tabId = useId()
const statusLabels: Record<string, string> = { draft: 'Draf', submitted: 'Diajukan' }
const kindLabels: Record<string, string> = { item: 'Barang', service: 'Jasa' }

const units = ref<Unit[]>([]), parties = ref<Party[]>([]), items = ref<Item[]>([])
const requests = ref<PurchaseRequest[]>([]), rfqs = ref<Rfq[]>([]), quotations = ref<Quotation[]>([])
const busy = ref(false), message = ref(''), success = ref(false)
// [MBX-9][IAM-002] Reads are scoped to a Unit: a unit-scoped procurement grant cannot read a
// tenant-wide list, so the panel always sends a Unit it is actually assigned to.
const filterUnit = ref('')
// [MBX-10][PROC-004] The comparison is per RFQ: the operator picks which RFQ to compare.
const comparisonRfqId = ref(''), comparison = ref<Comparison | null>(null)

const itemForm = ref({ unitId: '', code: '', name: '', kind: 'item', uom: 'pcs' })
const requestForm = ref({ unitId: '', bookDate: today(), justification: '', lines: [{ itemId: '', quantity: '1' }] })
const rfqForm = ref({ purchaseRequestId: '', bookDate: today(), vendorIds: [] as string[], note: '' })
const quotationForm = ref({ rfqId: '', partyId: '', bookDate: today(), validUntil: '', paymentTerm: '', deliveryDays: '', lines: [{ itemId: '', quantity: '1', unitPrice: '' }], supersedesId: '' })

function today() { return new Date().toISOString().slice(0, 10) }
const idr = (value: string) => new Intl.NumberFormat('id-ID').format(BigInt(value || '0'))
const unitName = (id: string) => units.value.find(unit => unit.id === id)?.name || 'Unit'
const partyName = (id: string) => parties.value.find(party => party.id === id)?.name || 'Vendor'
// Vendor Parties are the same Party identity used by AR/AP, filtered by the vendor role (PARTY-002).
const vendorsForUnit = (unitId: string) => parties.value.filter(party => party.roles.some(role => role.role === 'vendor' && (!role.unitId || role.unitId === unitId)))
const submittedRequests = computed(() => requests.value.filter(row => row.status === 'submitted'))
const selectedRequest = computed(() => requests.value.find(row => row.id === rfqForm.value.purchaseRequestId))
const rfqVendors = computed(() => selectedRequest.value ? vendorsForUnit(selectedRequest.value.unitId) : [])
const selectedRfq = computed(() => rfqs.value.find(row => row.id === quotationForm.value.rfqId))
const invitedVendors = computed(() => {
  const rfq = selectedRfq.value
  if (!rfq) return []
  return vendorsForUnit(rfq.unitId).filter(party => rfq.vendorIds.includes(party.id))
})
const itemOptions = (unitId: string) => items.value.filter(item => item.active && (!item.unitId || item.unitId === unitId))
const quotationTotal = computed(() => quotationForm.value.lines.reduce((sum, line) => sum + (BigInt(line.quantity || '0') * BigInt(line.unitPrice || '0')), 0n).toString())
// [MBX-10][PROC-004] Comparison cells are keyed by (vendor, item); keeping the lookup here avoids
// repeating it four times per cell in the template.
const offerFor = (vendor: ComparisonVendor, itemId: string) => vendor.offers.find(offer => offer.itemId === itemId)
// [MBX-10][PROC-004] The compared quantity is the one the vendors quoted, so it is shown with the
// item's uom: a bare number would not say what is being compared.
function offerQuantityLabel(item: Comparison['items'][number]) {
  const quantity = comparison.value?.vendors.map(vendor => offerFor(vendor, item.itemId)?.quantity).find(value => value)
  return quantity ? `${quantity} ${item.uom}` : '—'
}

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
    const all: Unit[] = []
    for (let page = 1; page <= 1000; page++) {
      const batch = await $fetch<Unit[]>(`/api/tenants/${props.tenantId}/units`, { query: { page } }); all.push(...batch)
      if (batch.length < 50) break
    }
    units.value = all.filter(unit => props.canViewAll || props.assignedUnitIds.includes(unit.id))
    const scopedParties: Party[] = []
    for (let page = 1; page <= 1000; page++) {
      const batch = await $fetch<Party[]>(`/api/tenants/${props.tenantId}/parties`, { query: { page } }); scopedParties.push(...batch)
      if (batch.length < 50) break
    }
    parties.value = scopedParties
    if (!filterUnit.value && !props.canViewAll) filterUnit.value = units.value[0]?.id || ''
    const scoped = filterUnit.value ? { unitId: filterUnit.value } : {}
    items.value = await $fetch<Item[]>(root.value + '/items', { query: scoped })
    requests.value = await $fetch<PurchaseRequest[]>(root.value + '/purchase-requests', { query: scoped })
    rfqs.value = await $fetch<Rfq[]>(root.value + '/rfqs', { query: scoped })
    quotations.value = await $fetch<Quotation[]>(root.value + '/quotations', { query: scoped })
    if (!requestForm.value.unitId) requestForm.value.unitId = units.value[0]?.id || ''
    if (!itemForm.value.unitId) itemForm.value.unitId = ''
    // Keep the compared RFQ valid after a Unit filter change, otherwise the read would point at a
    // Unit the actor can no longer read.
    if (!rfqs.value.some(rfq => rfq.id === comparisonRfqId.value)) comparisonRfqId.value = rfqs.value[0]?.id || ''
    await loadComparison()
  } catch { message.value = 'Data pengadaan belum dapat dimuat.'; success.value = false }
  finally { busy.value = false }
}

// [MBX-10][PROC-004] Loading the comparison is independent of the write commands, so a failed read
// never overwrites a success message from a save.
async function loadComparison() {
  if (!comparisonRfqId.value) { comparison.value = null; return }
  try { comparison.value = await $fetch<Comparison>(root.value + '/comparison', { query: { rfqId: comparisonRfqId.value } }) }
  catch { comparison.value = null }
}

async function save(task: () => Promise<unknown>, confirmation: string) {
  busy.value = true; message.value = ''; success.value = false
  try { await task(); await load(); message.value = confirmation; success.value = true }
  catch (error) {
    // [MBX-9] Surface the authored 409 domain message so the operator learns which rule refused
    // the command (for example a vendor that was never invited to this RFQ).
    const detail = (error as { data?: { statusMessage?: string }; statusMessage?: string })?.data?.statusMessage
      || (error as { statusMessage?: string })?.statusMessage
    message.value = detail && detail !== 'Invalid input' ? detail : 'Perubahan belum berhasil. Periksa data, Unit Usaha, dan akses Anda.'
  }
  finally { busy.value = false }
}

async function addItem() {
  const { unitId, code, name, kind, uom } = itemForm.value
  await save(() => $fetch(root.value + '/items', { method: 'POST', body: { unitId: unitId || null, code, name, kind, uom } }), 'Item berhasil dicatat.')
  if (success.value) itemForm.value = { ...itemForm.value, code: '', name: '' }
}
async function addRequest() {
  const body = { unitId: requestForm.value.unitId, locationId: null, bookDate: requestForm.value.bookDate,
    justification: requestForm.value.justification, lines: requestForm.value.lines, commandId: crypto.randomUUID() }
  await save(() => $fetch(root.value + '/purchase-requests', { method: 'POST', body }), 'Permintaan pembelian berhasil dibuat.')
  if (success.value) requestForm.value = { ...requestForm.value, justification: '', lines: [{ itemId: '', quantity: '1' }] }
}
async function submitRequest(id: string) {
  await save(() => $fetch(root.value + '/purchase-requests/submit', { method: 'POST', body: { purchaseRequestId: id } }), 'Permintaan pembelian berhasil diajukan.')
}
async function addRfq() {
  const body = { purchaseRequestId: rfqForm.value.purchaseRequestId, bookDate: rfqForm.value.bookDate,
    vendorIds: rfqForm.value.vendorIds, note: rfqForm.value.note || null, commandId: crypto.randomUUID() }
  await save(() => $fetch(root.value + '/rfqs', { method: 'POST', body }), 'RFQ berhasil dibuat dan vendor diundang.')
  if (success.value) rfqForm.value = { ...rfqForm.value, vendorIds: [], note: '' }
}
async function addQuotation() {
  const body = { rfqId: quotationForm.value.rfqId, partyId: quotationForm.value.partyId, bookDate: quotationForm.value.bookDate,
    validUntil: quotationForm.value.validUntil || null, paymentTerm: quotationForm.value.paymentTerm || null,
    deliveryDays: quotationForm.value.deliveryDays ? Number(quotationForm.value.deliveryDays) : null,
    lines: quotationForm.value.lines, supersedesId: quotationForm.value.supersedesId || null, commandId: crypto.randomUUID() }
  await save(() => $fetch(root.value + '/quotations', { method: 'POST', body }), 'Penawaran vendor berhasil dicatat.')
  if (success.value) quotationForm.value = { ...quotationForm.value, partyId: '', lines: [{ itemId: '', quantity: '1', unitPrice: '' }], supersedesId: '' }
}
// A correction is a new revision that names the quotation it supersedes; the old price is kept.
function revise(quotation: Quotation) {
  quotationForm.value = { rfqId: quotation.rfqId, partyId: quotation.partyId, bookDate: today(),
    validUntil: quotation.validUntil || '', paymentTerm: quotation.paymentTerm || '',
    deliveryDays: quotation.deliveryDays ? String(quotation.deliveryDays) : '',
    lines: quotation.lines.map(line => ({ itemId: line.itemId, quantity: line.quantity, unitPrice: line.unitPrice })),
    supersedesId: quotation.id }
  activeTab.value = 'quotations'
}
onMounted(load)
</script>

<template>
  <section class="procurement-page" :aria-busy="busy">
    <div class="procurement-overview">
      <div><span class="eyebrow muted">PENGADAAN BUMDES</span><h2>Pengadaan &amp; Penawaran Vendor</h2><p>Satu alur dari kebutuhan unit sampai perbandingan harga: catat permintaan, undang vendor lewat RFQ, lalu bandingkan penawaran secara setara. Persetujuan dan Purchase Order menyusul pada tahap berikutnya.</p></div>
      <div class="procurement-summary" aria-label="Ringkasan pengadaan"><div><strong>{{ requests.length }}</strong><span>Permintaan</span></div><div><strong>{{ rfqs.length }}</strong><span>RFQ</span></div><div><strong>{{ quotations.length }}</strong><span>Penawaran</span></div><div><strong>{{ items.length }}</strong><span>Item &amp; jasa</span></div></div>
    </div>
    <p v-if="message" :class="['notice', success ? 'success' : 'error']" :role="success ? 'status' : 'alert'">{{ message }}</p>
    <div class="procurement-tabs" role="tablist" aria-label="Bagian pengadaan">
      <button v-for="tab in tabs" :id="`${tabId}-${tab}-tab`" :key="tab" type="button" role="tab" :aria-selected="activeTab === tab" :aria-controls="`${tabId}-${tab}-panel`" :tabindex="activeTab === tab ? 0 : -1" @click="activeTab = tab" @keydown="navigateTabs"><AppIcon :name="tab === 'items' ? 'tag' : tab === 'rfq' ? 'cart' : tab === 'quotations' ? 'layers' : tab === 'comparison' ? 'search' : 'check'" :size="17" />{{ tabLabels[tab] }}</button>
      <button class="procurement-reload" type="button" :disabled="busy" aria-label="Muat ulang data pengadaan" @click="load"><AppIcon name="refresh" :size="16" /><span>Muat ulang</span></button>
    </div>
    <div class="procurement-filter">
      <label class="field">Unit Usaha<select v-model="filterUnit" :disabled="busy" @change="load"><option v-if="canViewAll" value="">Semua Unit</option><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label>
    </div>

    <div v-show="activeTab === 'requests'" :id="`${tabId}-requests-panel`" class="procurement-layout" role="tabpanel" :aria-labelledby="`${tabId}-requests-tab`" tabindex="0">
      <section class="panel procurement-main-card">
        <div class="panel-heading"><div><h2>Permintaan pembelian</h2><p>Setiap permintaan menyimpan Unit, item/jasa, kuantitas, alasan, dan statusnya.</p></div><span class="count-badge">{{ requests.length }} permintaan</span></div>
        <div v-if="!requests.length" class="empty-state"><AppIcon name="check" :size="30" /><h3>Belum ada permintaan</h3><p>Permintaan pembelian mencatat kebutuhan Unit: item atau jasa, jumlah, dan alasannya.</p></div>
        <div v-else class="table-scroll"><table><thead><tr><th scope="col">Nomor</th><th scope="col">Unit</th><th scope="col">Tanggal</th><th scope="col">Alasan</th><th scope="col" class="number-column">Baris</th><th scope="col">Status</th><th v-if="canCreateRequest" scope="col">Tindakan</th></tr></thead><tbody><tr v-for="request in requests" :key="request.id"><td><span class="document-id" :title="request.id">{{ request.number }}</span></td><td>{{ unitName(request.unitId) }}</td><td>{{ request.bookDate }}</td><td>{{ request.justification }}</td><td class="number-column">{{ request.lines.length }}</td><td><span :class="['status-pill', request.status === 'submitted' ? 'active' : 'inactive']">{{ statusLabels[request.status] || request.status }}</span></td><td v-if="canCreateRequest"><button type="button" class="link-button" :disabled="busy || request.status !== 'draft'" @click="submitRequest(request.id)">{{ request.status === 'draft' ? 'Ajukan' : 'Sudah diajukan' }}</button></td></tr></tbody></table></div>
      </section>
      <aside v-if="canCreateRequest" class="procurement-actions">
        <div class="panel procurement-action-card"><span class="action-icon"><AppIcon name="plus" :size="18" /></span><h3>Buat permintaan</h3><p>Permintaan berhenti pada status diajukan; persetujuan ditangani pada tahap berikutnya.</p>
          <form @submit.prevent="addRequest">
            <label class="field">Unit Usaha<select v-model="requestForm.unitId" required :disabled="busy"><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label>
            <label class="field">Tanggal buku<input v-model="requestForm.bookDate" type="date" required :disabled="busy"></label>
            <label class="field">Alasan / justifikasi<textarea v-model="requestForm.justification" required maxlength="1000" rows="2" placeholder="Contoh: kebutuhan stok bulan depan" :disabled="busy" /></label>
            <div class="line-heading"><strong>Baris item</strong><button type="button" class="text-button" :disabled="busy || requestForm.lines.length >= 100" @click="requestForm.lines.push({ itemId: '', quantity: '1' })">+ Tambah baris</button></div>
            <div v-for="(line, index) in requestForm.lines" :key="index" class="line-editor">
              <label class="field">Item / jasa<select v-model="line.itemId" required :disabled="busy"><option value="">Pilih item</option><option v-for="item in itemOptions(requestForm.unitId)" :key="item.id" :value="item.id">{{ item.code }} · {{ item.name }}</option></select></label>
              <label class="field">Jumlah<input v-model="line.quantity" required inputmode="numeric" pattern="[0-9]+" :disabled="busy"></label>
              <button v-if="requestForm.lines.length > 1" type="button" class="icon-button line-remove" aria-label="Hapus baris" :disabled="busy" @click="requestForm.lines.splice(index, 1)"><AppIcon name="close" :size="16" /></button>
            </div>
            <button class="button primary procurement-submit" :disabled="busy">{{ busy ? 'Menyimpan…' : 'Simpan permintaan' }}</button>
          </form>
        </div>
      </aside>
    </div>

    <div v-show="activeTab === 'rfq'" :id="`${tabId}-rfq-panel`" class="procurement-layout" role="tabpanel" :aria-labelledby="`${tabId}-rfq-tab`" tabindex="0">
      <section class="panel procurement-main-card">
        <div class="panel-heading"><div><h2>RFQ vendor</h2><p>Satu RFQ dapat ditujukan ke beberapa vendor sekaligus.</p></div><span class="count-badge">{{ rfqs.length }} RFQ</span></div>
        <div v-if="!rfqs.length" class="empty-state"><h3>Belum ada RFQ</h3><p>RFQ dibuat dari permintaan pembelian yang sudah diajukan.</p></div>
        <div v-else class="table-scroll"><table><thead><tr><th scope="col">Nomor</th><th scope="col">Permintaan</th><th scope="col">Unit</th><th scope="col">Tanggal</th><th scope="col" class="number-column">Vendor diundang</th><th scope="col">Catatan</th></tr></thead><tbody><tr v-for="rfq in rfqs" :key="rfq.id"><td><span class="document-id" :title="rfq.id">{{ rfq.number }}</span></td><td>{{ requests.find(row => row.id === rfq.purchaseRequestId)?.number || '—' }}</td><td>{{ unitName(rfq.unitId) }}</td><td>{{ rfq.bookDate }}</td><td class="number-column">{{ rfq.vendorIds.length }}</td><td>{{ rfq.note || '—' }}</td></tr></tbody></table></div>
      </section>
      <aside v-if="canManageRfq" class="procurement-actions">
        <div class="panel procurement-action-card"><span class="action-icon"><AppIcon name="cart" :size="18" /></span><h3>Buat RFQ</h3><p>Pilih permintaan yang sudah diajukan, lalu undang vendor pada Unit yang sama.</p>
          <form @submit.prevent="addRfq">
            <label class="field">Permintaan pembelian<select v-model="rfqForm.purchaseRequestId" required :disabled="busy" @change="rfqForm.vendorIds = []"><option value="">{{ submittedRequests.length ? 'Pilih permintaan diajukan' : 'Belum ada permintaan diajukan' }}</option><option v-for="request in submittedRequests" :key="request.id" :value="request.id">{{ request.number }} · {{ unitName(request.unitId) }}</option></select></label>
            <label class="field">Tanggal buku<input v-model="rfqForm.bookDate" type="date" required :disabled="busy"></label>
            <fieldset class="vendor-picker" :disabled="busy || !rfqForm.purchaseRequestId"><legend>Vendor diundang</legend><label v-for="party in rfqVendors" :key="party.id" class="vendor-option"><input v-model="rfqForm.vendorIds" type="checkbox" :value="party.id" :disabled="busy"><span>{{ party.name }}</span></label><p v-if="rfqForm.purchaseRequestId && !rfqVendors.length" class="hint">Belum ada Party dengan peran vendor pada Unit ini.</p></fieldset>
            <label class="field">Catatan<input v-model="rfqForm.note" maxlength="1000" placeholder="Opsional" :disabled="busy"></label>
            <button class="button primary procurement-submit" :disabled="busy || !rfqForm.vendorIds.length">{{ busy ? 'Menyimpan…' : 'Simpan RFQ' }}</button>
          </form>
        </div>
      </aside>
    </div>

    <div v-show="activeTab === 'quotations'" :id="`${tabId}-quotations-panel`" class="procurement-layout" role="tabpanel" :aria-labelledby="`${tabId}-quotations-tab`" tabindex="0">
      <section class="panel procurement-main-card">
        <div class="panel-heading"><div><h2>Penawaran vendor</h2><p>Harga disimpan per vendor dan per item, beserta termin pembayaran dan waktu pengiriman.</p></div><span class="count-badge">{{ quotations.length }} penawaran</span></div>
        <div v-if="!quotations.length" class="empty-state"><h3>Belum ada penawaran</h3><p>Catat penawaran dari vendor yang sudah diundang pada sebuah RFQ.</p></div>
        <div v-else class="table-scroll"><table><thead><tr><th scope="col">Nomor</th><th scope="col">RFQ</th><th scope="col">Vendor</th><th scope="col">Revisi</th><th scope="col">Termin</th><th scope="col" class="number-column">Kirim (hari)</th><th scope="col" class="number-column">Total (Rp)</th><th v-if="canQuote" scope="col">Tindakan</th></tr></thead><tbody><tr v-for="quotation in quotations" :key="quotation.id"><td><span class="document-id" :title="quotation.id">{{ quotation.number }}</span></td><td>{{ rfqs.find(row => row.id === quotation.rfqId)?.number || '—' }}</td><td><strong>{{ partyName(quotation.partyId) }}</strong></td><td><span class="revision-badge">rev {{ quotation.revision }}</span></td><td>{{ quotation.paymentTerm || '—' }}</td><td class="number-column">{{ quotation.deliveryDays ?? '—' }}</td><td class="number-column"><strong>{{ idr(quotation.total) }}</strong></td><td v-if="canQuote"><button type="button" class="link-button" :disabled="busy" @click="revise(quotation)">Revisi</button></td></tr></tbody></table></div>
      </section>
      <aside v-if="canQuote" class="procurement-actions">
        <div class="panel procurement-action-card"><span class="action-icon"><AppIcon name="layers" :size="18" /></span><h3>{{ quotationForm.supersedesId ? 'Revisi penawaran' : 'Catat penawaran' }}</h3><p>Revisi tidak menimpa harga lama: sistem menyimpan versi baru yang menunjuk penawaran sebelumnya.</p>
          <form @submit.prevent="addQuotation">
            <label class="field">RFQ<select v-model="quotationForm.rfqId" required :disabled="busy || !!quotationForm.supersedesId" @change="quotationForm.partyId = ''; quotationForm.supersedesId = ''"><option value="">Pilih RFQ</option><option v-for="rfq in rfqs" :key="rfq.id" :value="rfq.id">{{ rfq.number }} · {{ unitName(rfq.unitId) }}</option></select></label>
            <label class="field">Vendor<select v-model="quotationForm.partyId" required :disabled="busy || !quotationForm.rfqId || !!quotationForm.supersedesId"><option value="">{{ invitedVendors.length ? 'Pilih vendor' : 'Tidak ada vendor diundang' }}</option><option v-for="party in invitedVendors" :key="party.id" :value="party.id">{{ party.name }}</option></select></label>
            <div class="form-pair"><label class="field">Tanggal<input v-model="quotationForm.bookDate" type="date" required :disabled="busy"></label><label class="field">Berlaku sampai<input v-model="quotationForm.validUntil" type="date" :disabled="busy"></label></div>
            <div class="form-pair"><label class="field">Termin pembayaran<input v-model="quotationForm.paymentTerm" maxlength="160" placeholder="Contoh: Net 30" :disabled="busy"></label><label class="field">Waktu kirim (hari)<input v-model="quotationForm.deliveryDays" inputmode="numeric" pattern="[0-9]*" :disabled="busy"></label></div>
            <div class="line-heading"><strong>Baris harga</strong><button type="button" class="text-button" :disabled="busy || quotationForm.lines.length >= 100" @click="quotationForm.lines.push({ itemId: '', quantity: '1', unitPrice: '' })">+ Tambah baris</button></div>
            <div v-for="(line, index) in quotationForm.lines" :key="index" class="quotation-line">
              <label class="field">Item / jasa<select v-model="line.itemId" required :disabled="busy"><option value="">Pilih item</option><option v-for="item in itemOptions(selectedRfq?.unitId || '')" :key="item.id" :value="item.id">{{ item.code }} · {{ item.name }}</option></select></label>
              <label class="field">Jumlah<input v-model="line.quantity" required inputmode="numeric" pattern="[0-9]+" :disabled="busy"></label>
              <label class="field">Harga satuan (Rp)<input v-model="line.unitPrice" required inputmode="numeric" pattern="[0-9]+" :disabled="busy"></label>
              <button v-if="quotationForm.lines.length > 1" type="button" class="icon-button line-remove" aria-label="Hapus baris" :disabled="busy" @click="quotationForm.lines.splice(index, 1)"><AppIcon name="close" :size="16" /></button>
            </div>
            <p class="hint">Total penawaran: <strong>Rp {{ idr(quotationTotal) }}</strong></p>
            <button class="button primary procurement-submit" :disabled="busy || !quotationForm.partyId">{{ busy ? 'Menyimpan…' : (quotationForm.supersedesId ? 'Simpan revisi' : 'Simpan penawaran') }}</button>
          </form>
        </div>
      </aside>
    </div>

    <div v-show="activeTab === 'comparison'" :id="`${tabId}-comparison-panel`" class="procurement-layout single" role="tabpanel" :aria-labelledby="`${tabId}-comparison-tab`" tabindex="0">
      <section class="panel procurement-main-card">
        <div class="panel-heading"><div><h2>Perbandingan vendor</h2><p>Penawaran efektif per vendor untuk satu RFQ: harga item, total, pengiriman, termin, dan harga historis bila datanya ada. Revisi terbaru yang dibandingkan, dan riwayat harga yang belum ada ditandai eksplisit.</p></div>
          <label class="field comparison-picker">RFQ<select v-model="comparisonRfqId" :disabled="busy" @change="loadComparison"><option value="">Pilih RFQ</option><option v-for="rfq in rfqs" :key="rfq.id" :value="rfq.id">{{ rfq.number }} · {{ unitName(rfq.unitId) }}</option></select></label>
        </div>
        <div v-if="!comparison" class="empty-state"><h3>Belum ada yang dibandingkan</h3><p>Pilih RFQ yang sudah memiliki penawaran vendor.</p></div>
        <template v-else>
          <div class="comparison-summary">
            <div><strong>{{ comparison.summary.quoted }}/{{ comparison.summary.vendors }}</strong><span>Vendor menawar</span></div>
            <div><strong>{{ comparison.summary.revisions }}</strong><span>Penawaran direvisi</span></div>
            <div><strong>{{ comparison.summary.lowestTotal ? 'Rp ' + idr(comparison.summary.lowestTotal) : '—' }}</strong><span>Total terendah</span></div>
            <div><strong>{{ comparison.summary.hasHistoricalPrices ? 'Ada' : 'Belum ada' }}</strong><span>Riwayat harga</span></div>
          </div>
          <p v-if="comparison.purchaseRequest" class="hint comparison-source">Dari permintaan <strong>{{ comparison.purchaseRequest.number }}</strong> · {{ comparison.purchaseRequest.justification }}</p>
          <!-- The anchor date makes "historical" auditable from the UI itself: only prices strictly
               before this date can ever appear as history (PROC-004). -->
          <p class="comparison-basis">Tiap vendor diwakili revisi terbarunya. Harga historis hanya dihitung dari penawaran <strong>sebelum {{ comparison.summary.historicalAnchorDate }}</strong>, bukan dari RFQ yang lebih baru.</p>
          <!-- [MBX-10][PROC-004] "Belum ada" is stated, never rendered as a zero or an empty column
               that could be read as a price of nothing. The absence is declared once, here, instead
               of repeating a placeholder in every cell of every vendor. -->
          <p v-if="!comparison.summary.hasHistoricalPrices" class="comparison-note">Belum ada riwayat harga untuk vendor-vendor ini pada RFQ lain, jadi tiap sel hanya menampilkan harga penawaran saat ini. Harga historis muncul otomatis begitu ada penawaran pada RFQ yang lebih dahulu.</p>
          <div v-if="!comparison.vendors.length" class="empty-state"><h3>RFQ belum punya vendor</h3><p>Undang vendor pada RFQ ini terlebih dahulu.</p></div>
          <div v-else class="table-scroll"><table class="comparison-table">
            <thead><tr><th class="comparison-sticky" scope="col">Item</th><th class="number-column" scope="col">Jumlah</th><th v-for="vendor in comparison.vendors" :key="vendor.partyId" scope="col" class="number-column vendor-column"><span class="vendor-name">{{ vendor.name }}</span><small v-if="!vendor.invited" class="vendor-state skipped">tidak diundang</small><small v-else-if="!vendor.quotation" class="vendor-state pending">belum menawar</small><small v-else class="vendor-state quoted">rev {{ vendor.quotation.revision }} dari {{ vendor.quotation.revisionCount }}</small><span v-if="vendor.quotation" class="vendor-meta">kirim {{ vendor.quotation.deliveryDays ?? '—' }} hari · {{ vendor.quotation.paymentTerm || 'tanpa termin' }}</span></th></tr></thead>
            <tbody>
              <tr v-for="item in comparison.items" :key="item.itemId">
                <td class="comparison-sticky"><strong>{{ item.name }}</strong><small>{{ item.code }} · {{ item.uom }}</small></td>
                <td class="number-column">{{ offerQuantityLabel(item) }}</td>
                <td v-for="vendor in comparison.vendors" :key="vendor.partyId" class="number-column" :class="{ cheapest: item.cheapestPartyIds.includes(vendor.partyId) }">
                  <template v-if="offerFor(vendor, item.itemId)">
                    <span class="offer-line">
                      <span class="price">{{ idr(offerFor(vendor, item.itemId)!.unitPrice ?? offerFor(vendor, item.itemId)!.amount!) }}</span>
                      <span v-if="offerFor(vendor, item.itemId)!.mixedRate" class="cheapest-flag mixed">harga campuran</span>
                      <span v-else-if="item.cheapestPartyIds.includes(vendor.partyId)" class="cheapest-flag">termurah</span>
                    </span>
                    <!-- A mixed rate has no single price, so the cell shows the line total and says so
                         rather than presenting one of the two rates as if it were the whole quote. -->
                    <small v-if="offerFor(vendor, item.itemId)!.mixedRate" class="muted">beberapa tarif dalam satu penawaran</small>
                    <!-- [MBX-10][PROC-004] A prior price is shown only when it exists; when it does
                         not, the absence is already stated once above the table. -->
                    <small v-if="offerFor(vendor, item.itemId)!.historicalUnitPrice" class="history-line">sebelumnya {{ idr(offerFor(vendor, item.itemId)!.historicalUnitPrice!) }} ({{ offerFor(vendor, item.itemId)!.historicalBookDate }})<span :class="['delta', (offerFor(vendor, item.itemId)!.priceDeltaPct ?? 0) > 0 ? 'up' : (offerFor(vendor, item.itemId)!.priceDeltaPct ?? 0) < 0 ? 'down' : 'flat']">{{ (offerFor(vendor, item.itemId)!.priceDeltaPct ?? 0) > 0 ? '+' : '' }}{{ offerFor(vendor, item.itemId)!.priceDeltaPct ?? 0 }}%</span></small>
                  </template>
                  <span v-else class="muted">—</span>
                </td>
              </tr>
              <tr class="comparison-total"><td class="comparison-sticky"><strong>Total penawaran</strong></td><td></td>
                <td v-for="vendor in comparison.vendors" :key="vendor.partyId" class="number-column" :class="{ cheapest: comparison.summary.lowestTotalPartyIds.includes(vendor.partyId) }"><strong v-if="vendor.total">Rp {{ idr(vendor.total) }}</strong><span v-else class="muted">belum menawar</span><small v-if="vendor.itemsMissing" class="muted">{{ vendor.itemsMissing }} item belum dihargai</small></td>
              </tr>
            </tbody>
          </table></div>
        </template>
      </section>
    </div>

    <div v-show="activeTab === 'items'" :id="`${tabId}-items-panel`" class="procurement-layout" role="tabpanel" :aria-labelledby="`${tabId}-items-tab`" tabindex="0">
      <section class="panel procurement-main-card">
        <div class="panel-heading"><div><h2>Item &amp; jasa</h2><p>Item milik seluruh BUMDes bila Unit dikosongkan; item juga dapat dibatasi pada satu Unit.</p></div><span class="count-badge">{{ items.length }} item</span></div>
        <div v-if="!items.length" class="empty-state"><h3>Belum ada item</h3><p>Tambahkan item atau jasa agar dapat dipakai pada permintaan dan penawaran.</p></div>
        <div v-else class="table-scroll"><table><thead><tr><th scope="col">Kode</th><th scope="col">Nama</th><th scope="col">Jenis</th><th scope="col">Satuan</th><th scope="col">Cakupan</th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td><span class="document-id">{{ item.code }}</span></td><td><strong>{{ item.name }}</strong></td><td>{{ kindLabels[item.kind] || item.kind }}</td><td>{{ item.uom }}</td><td>{{ item.unitId ? unitName(item.unitId) : 'Seluruh BUMDes' }}</td></tr></tbody></table></div>
      </section>
      <aside v-if="canManageItems" class="procurement-actions">
        <div class="panel procurement-action-card"><span class="action-icon"><AppIcon name="tag" :size="18" /></span><h3>Tambah item</h3><p>Master data menentukan apa yang dibandingkan antar vendor, sehingga harga historis tetap setara.</p>
          <form @submit.prevent="addItem">
            <label class="field">Cakupan<select v-model="itemForm.unitId" :disabled="busy"><option value="">Seluruh BUMDes</option><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label>
            <label class="field">Kode<input v-model="itemForm.code" required maxlength="40" placeholder="Contoh: ITM-01" :disabled="busy"></label>
            <label class="field">Nama<input v-model="itemForm.name" required maxlength="160" placeholder="Contoh: Beras Premium 25kg" :disabled="busy"></label>
            <div class="form-pair"><label class="field">Jenis<select v-model="itemForm.kind" :disabled="busy"><option value="item">Barang</option><option value="service">Jasa</option></select></label><label class="field">Satuan<input v-model="itemForm.uom" required maxlength="20" placeholder="pcs / sak / trip" :disabled="busy"></label></div>
            <button class="button primary procurement-submit" :disabled="busy">{{ busy ? 'Menyimpan…' : 'Simpan item' }}</button>
          </form>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.procurement-page{display:grid;gap:18px}
.procurement-overview{display:flex;align-items:center;justify-content:space-between;gap:28px;padding:22px 24px;border:1px solid #e2e9ee;border-radius:13px;background:linear-gradient(120deg,#fff 62%,#f1f8f5)}
.procurement-overview h2{font-size:21px;margin:5px 0 6px}
.procurement-overview p{margin:0;color:#7d8998;font-size:12px;max-width:62ch}
.procurement-summary{display:flex;align-items:center;gap:22px;flex-shrink:0}
.procurement-summary>div{display:grid;gap:2px;min-width:64px}
.procurement-summary strong{font-size:17px;color:#243146}
.procurement-summary span{font-size:10px;color:#8d99a8}
.procurement-tabs{display:flex;align-items:center;gap:24px;overflow-x:auto;border-bottom:1px solid #dbe2e9}
.procurement-tabs>button{display:flex;align-items:center;gap:8px;padding:12px 0;border:0;border-bottom:2px solid transparent;background:transparent;color:#6b788b;font-size:13px;font-weight:500;white-space:nowrap}
.procurement-tabs>button:hover:not(:disabled){color:#243146}
.procurement-tabs>button[aria-selected="true"]{color:#07886d;border-bottom-color:#07886d}
.procurement-tabs .procurement-reload{margin-left:auto;padding:12px 10px;font-size:11px;color:#728094}
.procurement-filter{display:grid;grid-template-columns:repeat(1,minmax(150px,240px));gap:12px}
.procurement-filter .field{margin:0}
.procurement-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(290px,350px);gap:18px;align-items:start}
.procurement-main-card{min-width:0}
.procurement-actions{display:grid;gap:18px}
.procurement-action-card{padding:22px;position:sticky;top:20px}
.procurement-action-card h3{font-size:16px;margin:14px 0 6px}
.procurement-action-card>p{font-size:11px;line-height:1.7;color:#8491a1;margin:0 0 20px}
.procurement-action-card form{display:grid;gap:14px}
.procurement-action-card .field{margin:0}
.procurement-submit{width:100%;justify-content:center;margin-top:4px}
.action-icon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid #dcece6;border-radius:9px;background:#eef8f4;color:#19826d}
.document-id{display:inline-flex;padding:4px 7px;border-radius:5px;background:#f1f4f7;color:#526176;font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace}
.revision-badge{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:600;background:#e8f5f0;color:#147863}
.form-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
.line-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:4px;font-size:12px}
.line-editor{display:grid;grid-template-columns:1fr 90px 32px;gap:10px;align-items:end}
.quotation-line{display:grid;grid-template-columns:1fr 74px 1fr 32px;gap:10px;align-items:end}
.line-remove{align-self:end;margin-bottom:6px;color:#8b5560}
.vendor-picker{margin:0;padding:14px;border:1px solid #e2e9ee;border-radius:9px;display:grid;gap:9px}
.vendor-picker legend{padding:0 6px;font-size:11px;font-weight:600;color:#6b788b;text-transform:uppercase;letter-spacing:.04em}
.vendor-option{display:flex;align-items:center;gap:9px;font-size:12px;color:#3a4759}
.vendor-option input{accent-color:#07886d}
.hint{margin:0;font-size:11px;color:#7d8998}
.table-scroll{overflow-x:auto}
.procurement-main-card table{width:100%;border-collapse:collapse;font-size:12px}
.procurement-main-card th{position:sticky;top:0;z-index:1;text-align:left;padding:12px 16px;background:#f8fafb;border-bottom:1px solid #e6ecf0;color:#78859a;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.procurement-main-card td{padding:14px 16px;border-top:1px solid #edf1f4;color:#3a4759;vertical-align:middle}
.procurement-main-card tbody tr:hover{background:#fbfcfc}
.number-column{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.link-button{border:0;background:transparent;color:#07886d;font-size:11px;font-weight:600}
.link-button:hover:not(:disabled){text-decoration:underline}
.procurement-layout.single{grid-template-columns:minmax(0,1fr)}
.comparison-picker{min-width:240px;margin:0}
.comparison-summary{display:flex;flex-wrap:wrap;gap:22px;padding:16px 24px}
.comparison-summary>div{display:grid;gap:2px;min-width:96px}
.comparison-summary strong{font-size:16px;color:#243146}
.comparison-summary span{font-size:10px;color:#8d99a8}
.comparison-source{padding:0 24px;margin-bottom:10px}
.comparison-basis{padding:0 24px;margin:0 0 14px;font-size:11px;line-height:1.7;color:#7d8998}
.comparison-note{margin:0 24px 16px;padding:11px 14px;border:1px solid #ecd9b4;border-radius:9px;background:#fdf7ea;color:#8a6d33;font-size:11px}
.comparison-table th.vendor-column .vendor-name{display:block;font-size:11px;color:#354458;text-transform:none;letter-spacing:0;font-weight:700}
.comparison-table th.vendor-column small.vendor-state{display:inline-flex;align-items:center;margin-top:5px;padding:3px 7px;border-radius:999px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.vendor-state.quoted{background:#e8f5f0;color:#147863}
.vendor-state.pending{background:#fff8e8;color:#a3833b}
.vendor-state.skipped{background:#f1f4f7;color:#78859a}
.comparison-table th.vendor-column .vendor-meta{display:block;margin-top:5px;font-size:10px;font-weight:400;color:#98a4b2;text-transform:none;letter-spacing:0}
.comparison-table small{display:block;margin-top:3px;font-size:10px;font-weight:500}
.comparison-table td.comparison-sticky small,.comparison-table th.comparison-sticky small{display:block;color:#8d99a8;font-weight:400}
.comparison-table td.cheapest,.comparison-table tr.comparison-total td.cheapest{background:#eef7f1}
.comparison-table td small.history-line{margin-top:5px;color:#5c6b7f}
.comparison-table td small.history-line .delta{margin-left:5px;font-weight:700}
.delta.up{color:#a8552f}
.delta.down{color:#2f7a4f}
.delta.flat{color:#78859a}
.offer-line{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px}
.comparison-table .price{font-size:12px;font-weight:600;color:#243146;font-variant-numeric:tabular-nums}
.cheapest-flag{display:inline-flex;padding:3px 6px;border-radius:999px;background:#dbeee3;color:#2f7a4f;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.cheapest-flag.mixed{background:#fdf3e2;color:#96692a}
.comparison-table .muted{color:#98a4b2}
.comparison-table tr.comparison-total td{border-top:2px solid #e6ecf0;background:#f8fafb}
.procurement-page [role="tabpanel"]:focus{outline:none}
@media(max-width:1050px){.procurement-overview{align-items:flex-start;flex-direction:column}.procurement-summary{width:100%;flex-wrap:wrap}.procurement-layout{grid-template-columns:1fr}.procurement-action-card{position:static}}
/* Keeps the comparison gutter identical to .panel-heading, which main.css narrows at 760px. */
@media(max-width:760px){.comparison-summary{padding:16px 17px}.comparison-source,.comparison-basis{padding:0 17px}.comparison-note{margin:0 17px 16px}}
@media(max-width:650px){.procurement-overview{padding:18px}.procurement-tabs{gap:18px}.procurement-tabs .procurement-reload{margin-left:auto;padding:10px 8px}.procurement-reload span{display:none}.form-pair,.line-editor,.quotation-line{grid-template-columns:1fr}.quotation-line .line-remove,.line-editor .line-remove{justify-self:start;margin-bottom:0}.procurement-action-card{padding:18px}.procurement-main-card table{min-width:680px}.comparison-picker{min-width:0;width:100%}.panel-heading{flex-direction:column;align-items:flex-start;gap:12px}}
</style>
