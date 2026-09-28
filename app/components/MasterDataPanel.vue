<script setup lang="ts">
type Unit = { id: string; name: string }
type Location = { id: string; name: string; code: string; unitName: string }
type Party = { id: string; kind: string; name: string; code: string; roles: { role: string; unitId: string | null; unitName?:string | null }[] }
const props = defineProps<{ tenantId: string; kind: 'locations' | 'parties'; canManage: boolean }>()
const rows = ref<(Location | Party)[]>([]), units = ref<Unit[]>([])
const page = ref(1), busy = ref(false), message = ref(''), success = ref(false)
const dialog = ref<HTMLDialogElement | null>(null), name = ref(''), code = ref(''), unitId = ref(''), partyKind = ref('person'), partyId = ref<string | null>(null)
const selectedRoles = ref<{ role: string; unitId: string | null; unitName?:string | null }[]>([])
const labels: Record<string,string> = { customer: 'Pelanggan', vendor: 'Pemasok', employee: 'Pegawai' }
const title = computed(() => props.kind === 'locations' ? 'Lokasi' : 'Kontak & Mitra')
const endpoint = computed(() => `/api/tenants/${props.tenantId}/${props.kind}`)
async function load(next = page.value) {
  busy.value = true
  try { rows.value = await $fetch<(Location | Party)[]>(endpoint.value, { query: { page: next } }); page.value = next }
  catch { message.value = 'Data belum dapat dimuat. Periksa akses Anda.'; success.value = false }
  finally { busy.value = false }
}
async function open(item?: Party) {
  busy.value = true; message.value = ''; success.value = false
  try {
    const all: Unit[] = []
    for (let p = 1; p <= 1000; p++) {
      const batch = await $fetch<Unit[]>(`/api/tenants/${props.tenantId}/units`, { query: { page: p } }); all.push(...batch)
      if (batch.length < 50) break
    }
    units.value = all; name.value = item?.name || ''; code.value = item?.code || ''; partyKind.value = item?.kind || 'person'; partyId.value = item?.id || null
    unitId.value = all[0]?.id || ''; selectedRoles.value = item ? item.roles.map(({role,unitId}) => ({role,unitId})) : [{role:'customer',unitId:all[0]?.id || null}]
    dialog.value?.showModal()
  } catch { message.value = 'Pilihan Unit belum dapat dimuat.' }
  finally { busy.value = false }
}
async function save() {
  busy.value = true; message.value = ''; success.value = false
  try {
    const body = props.kind === 'locations' ? { name:name.value,code:code.value,unitId:unitId.value }
      : { name:name.value,code:code.value,kind:partyKind.value,roles:selectedRoles.value }
    await $fetch(endpoint.value + (partyId.value ? '/' + partyId.value : ''), { method: partyId.value ? 'PUT' : 'POST', body })
    dialog.value?.close(); success.value = true; message.value = 'Data berhasil disimpan.'; await load()
  } catch { message.value = 'Data belum dapat disimpan. Periksa kode unik, Unit Usaha, hubungan bisnis dan akses Anda.' }
  finally { busy.value = false }
}
onMounted(() => load())
</script>
<template>
  <section class="panel" :aria-busy="busy">
    <div class="panel-heading"><div><h2>{{ title }}</h2><p>{{ kind === 'parties' ? 'Kelola kontak perorangan dan organisasi yang bekerja sama dengan BUMDes.' : 'Lokasi operasional dalam Unit Usaha.' }}</p></div><div class="row-actions"><button class="button secondary" :disabled="busy" @click="load()"><AppIcon name="refresh" :size="16" />Muat ulang</button><button v-if="canManage" class="button primary" :disabled="busy" @click="open()"><AppIcon name="plus" :size="16" />Tambah</button></div></div>
    <p v-if="message && !dialog?.open" :class="['notice', success ? 'success' : 'error']" :role="success ? 'status' : 'alert'">{{ message }}</p>
    <div v-if="!rows.length" class="empty-state">{{ busy ? 'Memuat data…' : 'Belum ada data pada halaman ini.' }}</div>
    <div v-else class="table-scroll"><table><thead><tr><th>Nama</th><th>Kode</th><th>{{ kind === 'parties' ? 'Jenis kontak' : 'Unit Usaha' }}</th><th v-if="kind === 'parties' && canManage">Tindakan</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td><strong>{{ row.name }}</strong></td><td>{{ row.code }}</td><td><template v-if="'roles' in row">{{ row.kind === 'person' ? 'Perorangan' : 'Organisasi' }}</template><template v-else>{{ row.unitName }}</template></td><td v-if="'roles' in row && canManage"><button class="text-button" :disabled="busy" @click="open(row)">Edit</button></td></tr></tbody></table></div>
    <footer class="table-footer"><span>Halaman {{ page }} · Maksimal 50 data</span><nav aria-label="Halaman master data"><button class="button secondary" :disabled="busy || page === 1" @click="load(page - 1)">Sebelumnya</button><button class="button secondary" :disabled="busy || rows.length < 50" @click="load(page + 1)">Berikutnya</button></nav></footer>
    <dialog ref="dialog" class="unit-dialog users-dialog" aria-labelledby="master-data-heading" @cancel="busy && $event.preventDefault()"><form @submit.prevent="save"><div class="dialog-heading"><span class="stat-icon green"><AppIcon :name="kind === 'parties' ? 'party' : 'building'" /></span><button type="button" class="icon-button" aria-label="Tutup form" :disabled="busy" @click="dialog?.close()"><AppIcon name="close" /></button></div><h2 id="master-data-heading">{{ partyId ? 'Edit' : 'Tambah' }} {{ title }}</h2><p v-if="message" class="notice error" role="alert">{{ message }}</p><div class="contact-identity"><label class="field">Nama<input v-model="name" required maxlength="160" :disabled="busy"></label><label class="field">Kode<input v-model="code" required maxlength="40" :disabled="busy"></label></div>
      <label v-if="kind === 'locations'" class="field">Unit Usaha<select v-model="unitId" required :disabled="busy"><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label>
      <template v-else><label class="field">Jenis kontak<select v-model="partyKind" :disabled="busy"><option value="person">Perorangan</option><option value="organization">Organisasi</option></select></label><section class="contact-relationships"><div class="grant-heading"><strong>Hubungan bisnis</strong><button type="button" class="text-button" :disabled="busy || selectedRoles.length >= 30" @click="selectedRoles.push({role:'vendor',unitId:null})">+ Tambah hubungan</button></div><div v-for="(role,index) in selectedRoles" :key="index" class="grant-editor contact-relationship"><label class="field">Sebagai<select v-model="role.role" :disabled="busy"><option v-for="(label,key) in labels" :key="key" :value="key">{{ label }}</option></select></label><label class="field">Unit Usaha<select v-model="role.unitId" :disabled="busy"><option :value="null">Seluruh BUMDes</option><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label><button v-if="selectedRoles.length > 1" type="button" class="icon-button contact-remove" :aria-label="`Hapus hubungan ${labels[role.role]}`" :disabled="busy" @click="selectedRoles.splice(index,1)"><AppIcon name="close" :size="16" /></button></div></section></template>
      <div class="dialog-actions"><button type="button" class="button secondary" :disabled="busy" @click="dialog?.close()">Batal</button><button class="button primary" :disabled="busy">{{ busy ? 'Menyimpan…' : 'Simpan' }}</button></div>
    </form></dialog>
  </section>
</template>

<style scoped>
.contact-identity { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
.contact-relationships { margin-top: 24px; border-top: 1px solid #e7edf2; padding-top: 20px; }
.contact-relationships .grant-heading { margin-top: 0; font-size: 14px; gap: 12px; }
.contact-relationship { grid-template-columns: 1fr 1fr 32px; align-items: end; }
.contact-remove { align-self: end; margin-bottom: 6px; color: #8b5560; }
@media (max-width: 600px) {
  .contact-identity { grid-template-columns: 1fr; gap: 0; }
  .contact-relationship { grid-template-columns: 1fr 32px; }
  .contact-relationship .field:first-child { grid-column: 1 / -1; }
  .contact-relationships .grant-heading { flex-wrap: wrap; }
}
</style>
