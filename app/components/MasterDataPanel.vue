<script setup lang="ts">
type Unit = { id: string; name: string }
type Location = { id: string; name: string; code: string; unitName: string }
type Party = { id: string; kind: string; name: string; code: string; roles: { role: string; unitId: string | null; unitName?:string | null }[] }
const props = defineProps<{ tenantId: string; kind: 'locations' | 'parties'; canManage: boolean }>()
const rows = ref<(Location | Party)[]>([]), units = ref<Unit[]>([])
const page = ref(1), busy = ref(false), message = ref(''), success = ref(false)
const dialog = ref<HTMLDialogElement | null>(null), name = ref(''), code = ref(''), unitId = ref(''), partyKind = ref('person'), partyId = ref<string | null>(null)
const selectedRoles = ref<{ role: string; unitId: string | null; unitName?:string | null }[]>([])
const labels: Record<string,string> = { customer: 'Customer', vendor: 'Vendor', employee: 'Employee' }
const title = computed(() => props.kind === 'locations' ? 'Lokasi' : 'Party & Mitra')
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
  } catch { message.value = 'Data belum dapat disimpan. Periksa kode unik, Unit, role dan akses Anda.' }
  finally { busy.value = false }
}
onMounted(() => load())
</script>
<template>
  <section class="panel" :aria-busy="busy">
    <div class="panel-heading"><div><h2>{{ title }}</h2><p>{{ kind === 'parties' ? 'Satu identitas Person/Organization dengan beberapa role bisnis.' : 'Lokasi operasional dalam Unit Usaha.' }}</p></div><div class="row-actions"><button class="button secondary" :disabled="busy" @click="load()"><AppIcon name="refresh" :size="16" />Muat ulang</button><button v-if="canManage" class="button primary" :disabled="busy" @click="open()"><AppIcon name="plus" :size="16" />Tambah</button></div></div>
    <p v-if="message && !dialog?.open" :class="['notice', success ? 'success' : 'error']" :role="success ? 'status' : 'alert'">{{ message }}</p>
    <div v-if="!rows.length" class="empty-state">{{ busy ? 'Memuat data…' : 'Belum ada data pada halaman ini.' }}</div>
    <div v-else class="table-scroll"><table><thead><tr><th>Nama</th><th>Kode</th><th>{{ kind === 'parties' ? 'Tipe & Role' : 'Unit Usaha' }}</th><th v-if="kind === 'parties' && canManage">Tindakan</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td><strong>{{ row.name }}</strong></td><td>{{ row.code }}</td><td><template v-if="'roles' in row"><small>{{ row.kind === 'person' ? 'Person' : 'Organization' }}</small><div v-for="(role,index) in row.roles" :key="index">{{ labels[role.role] }} · {{ role.unitId ? role.unitName || units.find(u => u.id === role.unitId)?.name || 'Unit tertentu' : 'BUMDes' }}</div></template><template v-else>{{ row.unitName }}</template></td><td v-if="'roles' in row && canManage"><button class="text-button" :disabled="busy" @click="open(row)">Edit identitas & role</button></td></tr></tbody></table></div>
    <footer class="table-footer"><span>Halaman {{ page }} · Maksimal 50 data</span><nav aria-label="Halaman master data"><button class="button secondary" :disabled="busy || page === 1" @click="load(page - 1)">Sebelumnya</button><button class="button secondary" :disabled="busy || rows.length < 50" @click="load(page + 1)">Berikutnya</button></nav></footer>
    <dialog ref="dialog" class="unit-dialog users-dialog" aria-labelledby="master-data-heading" @cancel="busy && $event.preventDefault()"><form @submit.prevent="save"><h2 id="master-data-heading">{{ partyId ? 'Edit' : 'Tambah' }} {{ title }}</h2><p v-if="message" class="notice error" role="alert">{{ message }}</p><label class="field">Nama<input v-model="name" required maxlength="160" :disabled="busy"></label><label class="field">Kode<input v-model="code" required maxlength="40" :disabled="busy"></label>
      <label v-if="kind === 'locations'" class="field">Unit Usaha<select v-model="unitId" required :disabled="busy"><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label>
      <template v-else><label class="field">Tipe identitas<select v-model="partyKind" :disabled="busy"><option value="person">Person</option><option value="organization">Organization</option></select></label><div class="grant-heading"><strong>Role & context</strong><button type="button" class="text-button" :disabled="busy || selectedRoles.length >= 30" @click="selectedRoles.push({role:'vendor',unitId:null})">+ Tambah role</button></div><div v-for="(role,index) in selectedRoles" :key="index" class="grant-editor"><label class="field">Role<select v-model="role.role" :disabled="busy"><option v-for="(label,key) in labels" :key="key" :value="key">{{ label }}</option></select></label><label class="field">Context<select v-model="role.unitId" :disabled="busy"><option :value="null">Seluruh BUMDes</option><option v-for="unit in units" :key="unit.id" :value="unit.id">{{ unit.name }}</option></select></label><button v-if="selectedRoles.length > 1" type="button" class="text-button danger" :disabled="busy" @click="selectedRoles.splice(index,1)">Hapus</button></div></template>
      <div class="dialog-actions"><button type="button" class="button secondary" :disabled="busy" @click="dialog?.close()">Batal</button><button class="button primary" :disabled="busy">{{ busy ? 'Menyimpan…' : 'Simpan' }}</button></div>
    </form></dialog>
  </section>
</template>
