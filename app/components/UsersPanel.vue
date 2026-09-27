<script setup lang="ts">
type Grant = { role: string; scope: 'tenant' | 'unit'; unitId: string | null; unitName?: string | null }
type ManagedUser = { id: string; name: string; email: string; active: boolean; pending: boolean; grants: Grant[] }
type UnitOption = { id: string; name: string; code: string; active: boolean }
const props = defineProps<{ tenantId: string; currentUserId: string }>()
const emit = defineEmits<{ accessChanged: [] }>()
const users = ref<ManagedUser[]>([]), options = ref<UnitOption[]>([])
const page = ref(1), unitPage = ref(1), moreUnits = ref(false)
const loading = ref(false), saving = ref(false), message = ref(''), success = ref(false), emailConfigured = ref(false)
const search = ref(''), filter = ref('all'), mode = ref<'create' | 'edit'>('create')
const selected = ref<ManagedUser | null>(null), displayName = ref(''), email = ref(''), grants = ref<Grant[]>([])
const formDialog = ref<HTMLDialogElement | null>(null), actionDialog = ref<HTMLDialogElement | null>(null)
const action = ref<'disable' | 'enable' | 'revoke' | 'resend'>('disable')
const roleLabels: Record<string, string> = { admin: 'Admin BUMDes', director: 'Direktur', finance: 'Keuangan', unit_manager: 'Kepala Unit', operator: 'Operator', supervisor: 'Pengawas' }
const state = (item: ManagedUser) => item.pending ? 'pending' : item.active ? 'active' : 'disabled'
const visible = computed(() => users.value.filter(item => (filter.value === 'all' || filter.value === state(item))
  && (item.name + ' ' + item.email).toLocaleLowerCase('id').includes(search.value.trim().toLocaleLowerCase('id'))))
const actionLabels = { disable: 'Nonaktifkan akun', enable: 'Aktifkan kembali', revoke: 'Cabut sesi login', resend: 'Kirim ulang undangan' }
const actionExplanation = { disable: 'Pengguna tidak dapat masuk dan seluruh sesi loginnya akan dicabut. Riwayat data tetap tersimpan.',
  enable: 'Pengguna dapat masuk kembali menggunakan password miliknya.', revoke: 'Seluruh sesi login pengguna akan dicabut. Pengguna harus masuk kembali.',
  resend: 'Undangan lama akan diganti. Tautan aktivasi baru berlaku 24 jam dan dikirim melalui email.' }
const endpoint = computed(() => '/api/tenants/' + props.tenantId + '/users')
function errorText(error: unknown) {
  const response = error as { statusCode?: number; data?: { statusMessage?: string } }
  return response.statusCode === 409 ? response.data?.statusMessage || 'Email sudah digunakan atau perubahan tidak dapat dilakukan.'
    : 'Permintaan belum berhasil. Periksa akses dan input Anda, lalu coba kembali.'
}
async function load(next = page.value) {
  loading.value = true
  try {
    const result = await $fetch<{ users: ManagedUser[]; emailConfigured: boolean }>(endpoint.value, { query: { page: next } })
    users.value = result.users; emailConfigured.value = result.emailConfigured; page.value = next
  } catch { message.value = 'Daftar pengguna belum dapat dimuat.'; success.value = false }
  finally { loading.value = false }
}
async function loadOptions(next = 1) {
  const result = await $fetch<UnitOption[]>('/api/tenants/' + props.tenantId + '/units', { query: { page: next } })
  options.value = next === 1 ? result : [...options.value, ...result]
  unitPage.value = next; moreUnits.value = result.length === 50
}
async function openForm(item?: ManagedUser) {
  message.value = ''; success.value = false
  mode.value = item ? 'edit' : 'create'; selected.value = item || null
  displayName.value = item?.name || ''; email.value = item?.email || ''
  grants.value = item ? item.grants.map(({ role, scope, unitId }) => ({ role, scope, unitId })) : [{ role: 'operator', scope: 'unit', unitId: null }]
  loading.value = true
  try { await loadOptions(); formDialog.value?.showModal() }
  catch { message.value = 'Pilihan Unit belum dapat dimuat. Coba kembali.' }
  finally { loading.value = false }
}
function changeRole(grant: Grant) { if (grant.role === 'admin') { grant.scope = 'tenant'; grant.unitId = null } }
function changeScope(grant: Grant) { grant.unitId = grant.scope === 'tenant' ? null : options.value.find(unit => unit.active)?.id || null }
async function save() {
  saving.value = true; message.value = ''; success.value = false
  try {
    const result = mode.value === 'create'
      ? await $fetch<{ emailDelivery: string }>(endpoint.value, { method: 'POST', body: { name: displayName.value, email: email.value, grants: grants.value } })
      : await $fetch(endpoint.value + '/' + selected.value!.id + '/grants', { method: 'PUT', body: { grants: grants.value } })
    formDialog.value?.close(); success.value = true
    if (mode.value === 'create') {
      const delivery = (result as { emailDelivery: string }).emailDelivery
      message.value = delivery === 'sent' ? 'Akun dibuat. Email aktivasi sudah dikirim.'
        : 'Akun dibuat dan menunggu aktivasi. Email belum terkirim; konfigurasi SMTP lalu kirim ulang undangan.'
    } else { message.value = 'Role dan penugasan berhasil diperbarui.' }
    await load()
    if (selected.value?.id === props.currentUserId) emit('accessChanged')
  } catch (error) { message.value = errorText(error) }
  finally { saving.value = false }
}
function confirmAction(item: ManagedUser, next: typeof action.value) {
  selected.value = item; action.value = next; message.value = ''; success.value = false; actionDialog.value?.showModal()
}
async function executeAction() {
  if (!selected.value) return
  saving.value = true; message.value = ''; success.value = false
  try {
    const item = selected.value
    let result: { emailDelivery?: string } = {}
    if (action.value === 'resend') result = await $fetch(endpoint.value + '/' + item.id + '/invite', { method: 'POST' })
    else if (action.value === 'revoke') await $fetch('/api/tenants/' + props.tenantId + '/accounts/' + item.id + '/revoke', { method: 'POST' })
    else await $fetch(endpoint.value + '/' + item.id + '/status', { method: 'PUT', body: { active: action.value === 'enable' } })
    actionDialog.value?.close(); success.value = true
    message.value = action.value === 'resend'
      ? result.emailDelivery === 'sent' ? 'Undangan aktivasi sudah dikirim.' : 'Undangan diperbarui, tetapi email belum terkirim. Periksa konfigurasi SMTP.'
      : 'Perubahan akses berhasil disimpan.'
    await load()
    if (item.id === props.currentUserId) emit('accessChanged')
  } catch (error) { message.value = errorText(error) }
  finally { saving.value = false }
}
onMounted(() => load())
</script>
<template>
  <section class="users-workspace">
    <div class="section-actions"><p>Kelola akun, role, dan penugasan Unit dalam BUMDes Anda.</p><button class="button primary" :disabled="loading || saving" @click="openForm()"><AppIcon name="plus" :size="17" />Tambah pengguna</button></div>
    <p v-if="!emailConfigured && !loading" class="notice warning">Pengiriman email belum dikonfigurasi. Akun baru akan menunggu aktivasi; undangan dapat dikirim ulang setelah SMTP siap.</p>
    <p v-if="message && !formDialog?.open && !actionDialog?.open" :role="success ? 'status' : 'alert'" :class="['notice', success ? 'success' : 'error']">{{ message }}</p>
    <section class="panel" aria-labelledby="users-heading" :aria-busy="loading"><div class="panel-heading"><div><h2 id="users-heading">Pengguna & Akses<span class="count-badge">{{ users.length }}</span></h2><p>Akun pada halaman {{ page }} · Akses selalu diperiksa oleh server.</p></div><button class="button secondary refresh-button" :disabled="loading || saving" @click="load()"><AppIcon name="refresh" :size="16" />Muat ulang</button></div>
      <div class="table-toolbar"><label class="search-field"><AppIcon name="search" :size="18" /><input v-model="search" type="search" aria-label="Cari pengguna pada halaman ini" placeholder="Cari nama atau email…"></label><select v-model="filter" class="select-control" aria-label="Filter status pengguna"><option value="all">Semua status</option><option value="active">Aktif</option><option value="pending">Menunggu aktivasi</option><option value="disabled">Nonaktif</option></select></div>
      <div v-if="loading && !users.length" class="empty-state" role="status">Memuat pengguna…</div>
      <div v-else-if="!visible.length" class="empty-state"><AppIcon name="search" :size="30" /><h3>Tidak ada pengguna yang cocok</h3><p>Ubah pencarian, filter status, atau halaman yang dipilih.</p></div>
      <div v-else class="table-scroll"><table class="users-table"><thead><tr><th>Pengguna</th><th>Role & Scope</th><th>Status</th><th>Tindakan</th></tr></thead><tbody><tr v-for="item in visible" :key="item.id"><td><strong>{{ item.name }}</strong><small class="cell-secondary">{{ item.email }}{{ item.id === currentUserId ? ' · Anda' : '' }}</small></td><td><div v-for="(grant, index) in item.grants" :key="index" class="grant-summary">{{ roleLabels[grant.role] }}<small>{{ grant.scope === 'tenant' ? 'Seluruh BUMDes' : 'Unit: ' + (grant.unitName || options.find(unit => unit.id === grant.unitId)?.name || grant.unitId?.slice(0, 8)) }}</small></div></td><td><span :class="['status-pill', item.pending ? 'pending' : item.active ? 'active' : 'inactive']"><span class="small-dot" />{{ item.pending ? 'Menunggu aktivasi' : item.active ? 'Aktif' : 'Nonaktif' }}</span></td><td><div class="row-actions"><button class="text-button" :disabled="saving || loading" :aria-label="'Atur akses ' + item.name" @click="openForm(item)">Atur akses</button><button v-if="item.pending" class="text-button" :disabled="saving || loading" :aria-label="'Kirim undangan ' + item.name" @click="confirmAction(item, 'resend')">Kirim undangan</button><template v-else><button class="text-button" :disabled="saving || loading" :aria-label="'Cabut sesi ' + item.name" @click="confirmAction(item, 'revoke')">Cabut sesi</button><button :class="['text-button', { danger: item.active }]" :disabled="saving || loading" :aria-label="(item.active ? 'Nonaktifkan ' : 'Aktifkan ') + item.name" @click="confirmAction(item, item.active ? 'disable' : 'enable')">{{ item.active ? 'Nonaktifkan' : 'Aktifkan' }}</button></template></div></td></tr></tbody></table></div>
      <footer class="table-footer"><span>{{ visible.length }} dari {{ users.length }} pengguna · Halaman {{ page }}<small>Pencarian dan filter berlaku pada halaman ini.</small></span><nav aria-label="Halaman daftar pengguna"><button class="button secondary" :disabled="loading || saving || page === 1" @click="load(page - 1)">Sebelumnya</button><button class="button secondary" :disabled="loading || saving || users.length < 50" @click="load(page + 1)">Berikutnya</button></nav></footer>
    </section>
    <dialog ref="formDialog" class="unit-dialog users-dialog" aria-labelledby="user-form-heading" @cancel="saving && $event.preventDefault()"><form @submit.prevent="save"><div class="dialog-heading"><span class="stat-icon green"><AppIcon name="shield" /></span><button type="button" class="icon-button" aria-label="Tutup form pengguna" :disabled="saving" @click="formDialog?.close()"><AppIcon name="close" /></button></div><h2 id="user-form-heading">{{ mode === 'create' ? 'Tambah pengguna' : 'Atur akses pengguna' }}</h2><p class="subtext">{{ mode === 'create' ? 'Pengguna membuat password sendiri melalui email aktivasi.' : displayName + ' · ' + email }}</p><p v-if="message && !success" role="alert" class="notice error">{{ message }}</p>
      <template v-if="mode === 'create'"><label class="field">Nama lengkap<input v-model="displayName" required maxlength="160" :disabled="saving" autocomplete="off"></label><label class="field">Email<input v-model="email" type="email" required maxlength="254" :disabled="saving" autocomplete="off"></label></template>
      <div class="grant-heading"><strong>Role & penugasan</strong><button type="button" class="text-button" :disabled="saving || grants.length >= 30" @click="grants.push({ role: 'operator', scope: 'unit', unitId: null })">+ Tambah role</button></div>
      <div v-for="(grant, index) in grants" :key="index" class="grant-editor"><label class="field">Role<select v-model="grant.role" :disabled="saving" @change="changeRole(grant)"><option v-for="(label, value) in roleLabels" :key="value" :value="value">{{ label }}</option></select></label><label class="field">Scope<select v-model="grant.scope" :disabled="saving || grant.role === 'admin'" @change="changeScope(grant)"><option value="tenant">Seluruh BUMDes</option><option value="unit">Unit tertentu</option></select></label><label v-if="grant.scope === 'unit'" class="field grant-unit">Unit Usaha<select v-model="grant.unitId" required :disabled="saving"><option :value="null" disabled>Pilih Unit</option><option v-for="unit in options" :key="unit.id" :value="unit.id" :disabled="!unit.active">{{ unit.name }} · {{ unit.code }}</option></select></label><button v-if="grants.length > 1" class="text-button danger grant-remove" type="button" :disabled="saving" @click="grants.splice(index, 1)">Hapus role</button></div>
      <button v-if="moreUnits" type="button" class="button secondary" :disabled="saving || loading" @click="loadOptions(unitPage + 1).catch(() => message = 'Pilihan Unit belum dapat dimuat.')">Muat pilihan Unit berikutnya</button>
      <div class="dialog-actions"><button type="button" class="button secondary" :disabled="saving" @click="formDialog?.close()">Batal</button><button class="button primary" :disabled="saving">{{ saving ? 'Menyimpan…' : mode === 'create' ? 'Buat akun' : 'Simpan akses' }}</button></div>
    </form></dialog>
    <dialog ref="actionDialog" class="unit-dialog" aria-labelledby="account-action-heading" @cancel="saving && $event.preventDefault()"><form @submit.prevent="executeAction"><h2 id="account-action-heading">{{ actionLabels[action] }}</h2><p class="subtext"><strong>{{ selected?.name }}</strong><br>{{ actionExplanation[action] }}</p><p v-if="message && !success" role="alert" class="notice error">{{ message }}</p><div class="dialog-actions"><button type="button" class="button secondary" :disabled="saving" @click="actionDialog?.close()">Batal</button><button class="button primary" :disabled="saving">{{ saving ? 'Memproses…' : 'Konfirmasi' }}</button></div></form></dialog>
  </section>
</template>
