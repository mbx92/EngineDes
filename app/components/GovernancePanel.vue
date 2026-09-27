<script setup lang="ts">
type Config = { key: string; revision: number; value: unknown }
const props = defineProps<{ tenantId:string; section:'security' | 'customer' | 'sequence' | 'audit' }>()
const rows = ref<Config[]>([]), audits = ref<{ id:string; createdAt:string; action:string; actorId:string; entityId:string }[]>([])
const busy = ref(false), message = ref(''), success = ref(false), page = ref(1)
const type = ref('retail_cash'), anonymousAllowed = ref(false), prefix = ref('DOC'), scope = ref('tenant'), reset = ref('never')
const timezone = ref('UTC'), passwordMinimum = ref(12), separationOfDuties = ref(true)
const endpoint = computed(() => `/api/tenants/${props.tenantId}`)
const key = computed(() => props.section === 'security' ? 'security' : `${props.section}:${type.value}`)
const current = computed(() => rows.value.find(row => row.key === key.value))
function populate() {
  const value = current.value?.value as Record<string,unknown> | undefined
  if (props.section === 'security') { timezone.value = String(value?.timezone || 'UTC'); passwordMinimum.value = Number(value?.passwordMinimum || 12); separationOfDuties.value = value?.separationOfDuties !== false }
  if (props.section === 'customer') anonymousAllowed.value = value?.anonymousAllowed === true
  if (props.section === 'sequence') { prefix.value = String(value?.prefix || 'DOC'); scope.value = String(value?.scope || 'tenant'); reset.value = String(value?.reset || 'never') }
}
async function load(next = page.value) {
  busy.value = true
  try {
    if (props.section === 'audit') { audits.value = await $fetch(endpoint.value + '/audit', {query:{page:next}}); page.value = next }
    else { rows.value = await $fetch(endpoint.value + '/configurations'); populate() }
  } catch { message.value = 'Pengaturan belum dapat dimuat.'; success.value = false }
  finally { busy.value = false }
}
async function save() {
  busy.value = true; message.value = ''; success.value = false
  const value = props.section === 'security' ? {timezone:timezone.value,passwordMinimum:passwordMinimum.value,separationOfDuties:separationOfDuties.value}
    : props.section === 'customer' ? {anonymousAllowed:anonymousAllowed.value} : {prefix:prefix.value,scope:scope.value,reset:reset.value}
  try { await $fetch(endpoint.value+'/configurations',{method:'POST',body:{key:key.value,value,expectedRevision:current.value?.revision || 0}}); message.value='Pengaturan berhasil disimpan.';success.value=true;await load() }
  catch(error) { const e=error as {data?:{statusMessage?:string}}; message.value=e.data?.statusMessage || 'Pengaturan belum dapat disimpan. Periksa input dan akses Anda.' }
  finally { busy.value=false }
}
watch(type,populate)
onMounted(() => load())
</script>
<template>
  <section class="panel settings-card" :aria-busy="busy">
    <div class="governance-heading"><h2>{{ section === 'security' ? 'Keamanan & konteks organisasi' : section === 'customer' ? 'Customer Policy' : section === 'sequence' ? 'Penomoran dokumen' : 'Audit aktivitas' }}</h2><button class="button secondary" :disabled="busy" @click="load()"><AppIcon name="refresh" :size="16" />Muat ulang</button></div>
    <p v-if="message" :class="['notice',success?'success':'error']" :role="success?'status':'alert'">{{ message }}</p>
    <template v-if="section === 'audit'"><div v-if="!audits.length" class="empty-state">Belum ada aktivitas pada halaman ini.</div><div v-else class="table-scroll"><table><thead><tr><th>Waktu</th><th>Aktivitas</th><th>Actor</th><th>Referensi</th></tr></thead><tbody><tr v-for="entry in audits" :key="entry.id"><td>{{ new Date(entry.createdAt).toLocaleString('id-ID') }}</td><td>{{ entry.action }}</td><td>{{ entry.actorId }}</td><td>{{ entry.entityId }}</td></tr></tbody></table></div><div class="dialog-actions"><button class="button secondary" :disabled="busy || page === 1" @click="load(page-1)">Sebelumnya</button><button class="button secondary" :disabled="busy || audits.length < 50" @click="load(page+1)">Berikutnya</button></div></template>
    <form v-else class="governance-form" @submit.prevent="save">
      <template v-if="section === 'security'"><label class="field">Timezone organisasi<input v-model="timezone" required placeholder="Asia/Makassar" :disabled="busy"></label><label class="field">Minimum panjang password<input v-model.number="passwordMinimum" type="number" min="12" max="128" required :disabled="busy"></label><label class="checkbox-field"><input v-model="separationOfDuties" type="checkbox" :disabled="busy">Creator tidak boleh menyetujui transaksi sendiri</label><p class="subtext">Sesi berlaku 24 jam. Perubahan minimum password berlaku pada aktivasi dan perubahan password berikutnya. MFA belum tersedia.</p></template>
      <template v-else><label class="field">Jenis transaksi<input v-model="type" required pattern="[a-z][a-z0-9_]{0,39}" maxlength="40" :disabled="busy" placeholder="retail_cash"></label><template v-if="section === 'customer'"><label class="checkbox-field"><input v-model="anonymousAllowed" type="checkbox" :disabled="busy">Izinkan transaksi tanpa identitas Customer</label><p class="subtext">Transaksi yang menghasilkan piutang (AR) selalu membutuhkan Party, termasuk ketika anonymous diizinkan.</p></template><template v-else><label class="field">Prefix<input v-model="prefix" required pattern="[A-Z0-9-]{1,20}" maxlength="20" :disabled="busy || !!current"></label><label class="field">Scope<select v-model="scope" :disabled="busy || !!current"><option value="tenant">BUMDes</option><option value="unit">Per Unit</option></select></label><label class="field">Reset<select v-model="reset" :disabled="busy || !!current"><option value="never">Tidak reset</option><option value="year">Tahunan</option><option value="month">Bulanan</option></select></label><p class="subtext">Format sequence yang sudah dibuat dipertahankan untuk menjaga nomor historis. Gunakan jenis dokumen baru untuk format berbeda.</p></template><div v-if="rows.some(row => row.key.startsWith(section + ':'))" class="configured-types"><span>Jenis yang tersedia:</span><button v-for="row in rows.filter(row => row.key.startsWith(section + ':'))" :key="row.key" type="button" class="text-button" @click="type=row.key.split(':')[1]!">{{ row.key.split(':')[1] }}</button></div></template>
      <p class="subtext">Revisi {{ current?.revision || 0 }}</p><button class="button primary" :disabled="busy || (section === 'sequence' && !!current)">{{ busy?'Menyimpan…':'Simpan pengaturan' }}</button>
    </form>
  </section>
</template>
