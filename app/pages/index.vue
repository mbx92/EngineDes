<script setup lang="ts">
import { createAuthClient } from 'better-auth/vue'

// MBX-5 / ORG-001/002, IAM-001/002: only verified session/access and scoped Unit data.
type Unit = { id: string; name: string; code: string; active: boolean }
type Access = { tenantId: string; tenantName: string; grants: { role: string; scope: string; unitId: string | null }[]; canCreateUnit: boolean; canManageUsers: boolean; canUpdateOrganization: boolean; canManageParties: boolean; canManageLocations: boolean; canReadAccounting: boolean; canViewAllAccounting: boolean; canManageAccounting: boolean; canCloseAccounting: boolean }
const auth = createAuthClient()
const email = ref(''), password = ref(''), name = ref(''), code = ref('')
const access = ref<Access | null>(null), units = ref<Unit[]>([])
const busy = ref(false), message = ref(''), success = ref(false)
const signedIn = ref(false), ready = ref(false), page = ref(1)
const userName = ref(''), userId = ref('')
const view = ref<'overview' | 'units' | 'users' | 'settings' | 'parties' | 'locations' | 'accounting'>('overview')
const viewTitles = { overview: 'Ringkasan', units: 'Unit Usaha', users: 'Pengguna & Akses', settings: 'Pengaturan', parties: 'Kontak & Mitra', locations: 'Lokasi', accounting: 'Akuntansi' }
const search = ref(''), status = ref('all'), mobileMenu = ref(false)
const unitDialog = ref<HTMLDialogElement | null>(null)
const initials = computed(() => userName.value.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'U')
const activeUnits = computed(() => units.value.filter(unit => unit.active).length)
const visibleUnits = computed(() => units.value.filter(unit =>
  (unit.name + ' ' + unit.code).toLocaleLowerCase('id').includes(search.value.trim().toLocaleLowerCase('id'))
  && (status.value === 'all' || unit.active === (status.value === 'active'))))
const roles: Record<string, string> = { admin: 'Admin BUMDes', director: 'Direktur', finance: 'Keuangan', unit_manager: 'Kepala Unit', operator: 'Operator', supervisor: 'Pengawas' }
const roleLabel = computed(() => [...new Set(access.value?.grants.map(grant => roles[grant.role] || grant.role) || [])].join(', ') || 'Pengguna')

async function loadUnits(next = page.value) {
  if (!access.value) return
  const result = await $fetch<Unit[]>('/api/tenants/' + access.value.tenantId + '/units', { query: { page: next } })
  units.value = result; page.value = next
}
async function load() {
  const result = await auth.getSession()
  if (result.error) throw new Error('Session unavailable')
  signedIn.value = !!result.data
  access.value = null; units.value = []
  if (result.data) {
    userName.value = result.data.user.name
    userId.value = result.data.user.id
    access.value = await $fetch<Access>('/api/access')
    if ((view.value === 'users' && !access.value.canManageUsers) || (view.value === 'settings' && !access.value.canUpdateOrganization) || (view.value === 'accounting' && !access.value.canReadAccounting)) view.value = 'overview'
    await loadUnits()
  }
}
async function run(operation: () => Promise<void>) {
  busy.value = true; message.value = ''; success.value = false
  try { await operation() }
  catch { message.value = 'Permintaan belum berhasil. Periksa koneksi dan akses Anda, lalu coba kembali.' }
  finally { busy.value = false }
}
async function login() {
  await run(async () => {
    const result = await auth.signIn.email({ email: email.value, password: password.value, rememberMe: false })
    password.value = ''
    if (result.error) { message.value = 'Login gagal. Periksa email dan password Anda.'; return }
    page.value = 1; view.value = 'overview'; search.value = ''; status.value = 'all'
    await load()
  })
}
async function logout() {
  await run(async () => {
    const result = await auth.signOut()
    if (result.error) throw new Error('Logout failed')
    signedIn.value = false; access.value = null; units.value = []; mobileMenu.value = false; userName.value = ''
  })
}
function navigate(next: typeof view.value) { view.value = next; mobileMenu.value = false }
function openUnit() { name.value = ''; code.value = ''; message.value = ''; unitDialog.value?.showModal() }
async function addUnit() {
  if (!access.value?.canCreateUnit) return
  await run(async () => {
    await $fetch('/api/tenants/' + access.value!.tenantId + '/units', { method: 'POST', body: { name: name.value, code: code.value } })
    unitDialog.value?.close(); name.value = ''; code.value = ''; search.value = ''; status.value = 'all'
    // A successful write stays successful even when refreshing fails; avoid duplicate submission.
    success.value = true; message.value = 'Unit berhasil dibuat.'
    try { await loadUnits(1) } catch { message.value = 'Unit berhasil dibuat. Muat ulang daftar untuk melihatnya.' }
  })
}
onMounted(async () => { await run(load); ready.value = true })
</script>

<template>
  <div v-if="!ready" class="loading-screen" role="status"><div class="brand-mark"><AppIcon name="leaf" :size="26" /></div><strong>EngineDes</strong><span class="loading-dot" />Menyiapkan ruang kerja Anda…</div>
  <main v-else-if="!signedIn" class="login-layout">
    <section class="login-story">
      <a href="/" class="brand"><span class="brand-mark"><AppIcon name="leaf" :size="25" /></span>EngineDes<span class="brand-label">BUMDes Platform</span></a>
      <div class="story-content"><span class="eyebrow">DARI DESA, UNTUK MASA DEPAN</span><h1>Kelola potensi desa.<br><span>Bangun dampak nyata.</span></h1><p>Satu ruang kerja untuk mengelola Unit Usaha dan mendukung operasional BUMDes Anda.</p>
        <div class="story-illustration" aria-hidden="true"><div class="orbit orbit-one" /><div class="orbit orbit-two" /><div class="illustration-center"><AppIcon name="building" :size="56" /></div><div class="floating-tile tile-one"><AppIcon name="layers" /><span>Unit Usaha</span></div><div class="floating-tile tile-two"><AppIcon name="shield" /><span>Akses terkontrol</span></div><div class="floating-tile tile-three"><AppIcon name="leaf" /><span>Tumbuh bersama</span></div></div>
      </div><div class="story-footer"><span class="small-dot" />Terhubung dalam satu ekosistem.</div>
    </section>
    <section class="login-panel" aria-labelledby="login-title"><div class="login-form-wrap"><div class="login-mobile-brand"><span class="brand-mark"><AppIcon name="leaf" /></span>EngineDes</div><span class="eyebrow muted">SELAMAT DATANG KEMBALI</span><h2 id="login-title">Masuk ke ruang kerja</h2><p class="subtext">Gunakan akun yang diberikan oleh admin BUMDes Anda.</p>
      <p v-if="message" role="alert" class="notice error">{{ message }}</p>
      <form class="login-form" @submit.prevent="login"><label class="field">Email<input v-model="email" name="email" type="email" autocomplete="username" placeholder="nama@bumdes.id" required :disabled="busy"></label><label class="field">Password<input v-model="password" name="password" type="password" autocomplete="current-password" placeholder="Masukkan password Anda" required :disabled="busy"></label><button type="submit" class="button primary login-submit" :disabled="busy">{{ busy ? 'Memproses…' : 'Masuk ke dashboard' }}<AppIcon name="arrow" :size="18" /></button></form>
      <div class="login-help"><AppIcon name="lock" :size="16" /><p>Belum memiliki akses? Hubungi admin BUMDes Anda.</p></div>
    </div><p class="login-bottom">EngineDes · Ruang kerja BUMDes</p></section>
  </main>
  <div v-else class="dashboard-shell">
    <button v-if="mobileMenu" class="sidebar-backdrop" aria-label="Tutup navigasi" @click="mobileMenu = false" />
    <aside class="sidebar" :class="{ 'is-open': mobileMenu }"><a href="/" class="brand"><span class="brand-mark"><AppIcon name="leaf" :size="25" /></span><span>EngineDes<small>BUMDes Platform</small></span></a>
      <div class="workspace-switch"><span class="workspace-icon"><AppIcon name="building" /></span><div><strong>{{ access?.tenantName || "Workspace BUMDes" }}</strong><span>Operasional organisasi</span></div></div>
      <p class="nav-caption">RUANG KERJA</p><nav aria-label="Navigasi utama"><button :class="['nav-item', { selected: view === 'overview' }]" :aria-current="view === 'overview' ? 'page' : undefined" @click="navigate('overview')"><AppIcon name="grid" />Ringkasan</button><button :class="['nav-item', { selected: view === 'units' }]" :aria-current="view === 'units' ? 'page' : undefined" @click="navigate('units')"><AppIcon name="building" />Unit Usaha</button><button v-if="access?.canManageLocations" :class="['nav-item', { selected: view === 'locations' }]" :aria-current="view === 'locations' ? 'page' : undefined" @click="navigate('locations')"><AppIcon name="building" />Lokasi</button><button v-if="access?.canManageParties" :class="['nav-item', { selected: view === 'parties' }]" :aria-current="view === 'parties' ? 'page' : undefined" @click="navigate('parties')"><AppIcon name="party" />Kontak &amp; Mitra</button><button v-if="access?.canReadAccounting" :class="['nav-item', { selected: view === 'accounting' }]" :aria-current="view === 'accounting' ? 'page' : undefined" @click="navigate('accounting')"><AppIcon name="layers" />Akuntansi</button><button v-if="access?.canManageUsers" :class="['nav-item', { selected: view === 'users' }]" :aria-current="view === 'users' ? 'page' : undefined" @click="navigate('users')"><AppIcon name="shield" />Pengguna &amp; Akses</button><button v-if="access?.canUpdateOrganization" :class="['nav-item', { selected: view === 'settings' }]" :aria-current="view === 'settings' ? 'page' : undefined" @click="navigate('settings')"><AppIcon name="gear" />Pengaturan</button></nav>
      <div class="sidebar-profile"><span class="avatar">{{ initials }}</span><div><strong>{{ userName }}</strong><span>{{ roleLabel }}</span></div><button class="icon-button" :disabled="busy" aria-label="Keluar dari akun" @click="logout"><AppIcon name="logout" :size="18" /></button></div>
    </aside>
    <div class="dashboard-main"><header class="topbar"><div class="breadcrumb"><button class="icon-button menu-toggle" aria-label="Buka navigasi" :aria-expanded="mobileMenu" @click="mobileMenu = !mobileMenu"><AppIcon name="layers" /></button><span>Workspace</span><AppIcon name="chevron" :size="13" /><strong>{{ viewTitles[view] }}</strong></div><div class="topbar-right"><span class="workspace-badge"><span class="small-dot" />BUMDes Platform</span><span class="avatar small" :title="userName">{{ initials }}</span></div></header>
      <main id="main-content" class="dashboard-content" :aria-busy="busy"><div class="page-heading"><div><span class="eyebrow muted">RUANG KERJA ANDA</span><h1>{{ view === 'overview' ? 'Ringkasan dashboard' : viewTitles[view] }}</h1><p>{{ view === 'overview' ? 'Selamat datang, ' + userName + '. Mari kelola potensi BUMDes Anda.' : view === 'units' ? 'Kelola dan temukan Unit Usaha sesuai akses Anda.' : view === 'users' ? 'Kelola pengguna dan akses organisasi Anda.' : 'Profil organisasi dan informasi kebijakan keamanan.' }}</p></div><button v-if="access?.canCreateUnit && (view === 'overview' || view === 'units')" class="button primary" :disabled="busy" @click="openUnit"><AppIcon name="plus" :size="18" />Tambah Unit</button></div>
        <p v-if="message" :role="success ? 'status' : 'alert'" :class="['notice', success ? 'success' : 'error']">{{ message }}</p>
        <div v-if="!access" class="panel empty-state"><AppIcon name="shield" :size="36" /><h2>Ruang kerja belum dapat dimuat</h2><p>Periksa koneksi atau hubungi admin untuk memastikan akses Anda.</p><button class="button secondary" :disabled="busy" @click="run(load)">Coba lagi</button></div>
        <template v-else>
          <section v-if="view === 'overview'" class="welcome-banner"><div><span class="banner-tag"><AppIcon name="leaf" :size="14" />PENGELOLAAN UNIT USAHA</span><h2>Potensi lokal, pengelolaan yang lebih baik.</h2><p>Bangun fondasi operasional dengan menata Unit Usaha BUMDes Anda.</p><button class="banner-link" @click="navigate('units')">Jelajahi Unit Usaha<AppIcon name="arrow" :size="17" /></button></div><div class="banner-art" aria-hidden="true"><AppIcon name="building" :size="92" /><span /><span /></div></section>
          <section v-if="view === 'overview' || view === 'units'" class="stats-grid" aria-label="Ringkasan Unit pada halaman ini"><article class="stat-card"><div class="stat-top"><span>Unit ditampilkan</span><span class="stat-icon green"><AppIcon name="building" /></span></div><strong>{{ units.length }}</strong><p>Data pada halaman {{ page }}</p></article><article class="stat-card"><div class="stat-top"><span>Unit aktif</span><span class="stat-icon blue"><AppIcon name="check" /></span></div><strong>{{ activeUnits }}</strong><p>Dari {{ units.length }} Unit pada halaman ini</p></article><article class="stat-card"><div class="stat-top"><span>Unit nonaktif</span><span class="stat-icon amber"><AppIcon name="clock" /></span></div><strong>{{ units.length - activeUnits }}</strong><p>Dari {{ units.length }} Unit pada halaman ini</p></article><article class="stat-card access-card"><div class="stat-top"><span>Akses ruang kerja</span><span class="stat-icon violet"><AppIcon name="shield" /></span></div><strong class="role-value">{{ roleLabel }}</strong><p>{{ access.canCreateUnit ? 'Dapat mengelola Unit Usaha' : 'Sesuai penugasan Unit Anda' }}</p></article></section>
          <section v-if="view === 'overview' || view === 'units'" class="panel units-panel" aria-labelledby="units-title"><div class="panel-heading"><div><h2 id="units-title">Daftar Unit Usaha<span class="count-badge">{{ units.length }}</span></h2><p>Unit yang tersedia sesuai penugasan Anda.</p></div><button class="button secondary refresh-button" :disabled="busy" @click="run(() => loadUnits())"><AppIcon name="refresh" :size="16" /><span>Muat ulang</span></button></div>
            <div class="table-toolbar"><label class="search-field"><AppIcon name="search" :size="18" /><input v-model="search" type="search" aria-label="Cari Unit pada halaman ini" placeholder="Cari nama atau kode Unit…"></label><label class="filter-field"><span>Status</span><select v-model="status" aria-label="Filter status Unit"><option value="all">Semua status</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></label></div>
            <div v-if="units.length === 0" class="empty-state"><div class="empty-icon"><AppIcon name="building" :size="30" /></div><h3>{{ page === 1 ? 'Belum ada Unit Usaha' : 'Tidak ada Unit pada halaman ini' }}</h3><p>{{ access.canCreateUnit && page === 1 ? 'Tambahkan Unit pertama untuk mulai menata operasional BUMDes Anda.' : 'Unit akan muncul di sini sesuai penugasan dan halaman yang dipilih.' }}</p><button v-if="access.canCreateUnit && page === 1" class="button primary" :disabled="busy" @click="openUnit"><AppIcon name="plus" :size="17" />Tambah Unit pertama</button></div>
            <div v-else-if="visibleUnits.length === 0" class="empty-state"><AppIcon name="search" :size="30" /><h3>Tidak ada hasil yang cocok</h3><p>Coba kata kunci lain atau ubah filter status pada halaman ini.</p><button class="button secondary" @click="search = ''; status = 'all'">Reset pencarian</button></div>
            <div v-else class="table-scroll"><table><thead><tr><th scope="col">Nama Unit Usaha</th><th scope="col">Kode Unit</th><th scope="col">Status</th></tr></thead><tbody><tr v-for="unit in visibleUnits" :key="unit.id"><td><div class="unit-cell"><span class="unit-icon"><AppIcon name="building" :size="19" /></span><strong>{{ unit.name }}</strong></div></td><td><span class="unit-code">{{ unit.code }}</span></td><td><span :class="['status-pill', unit.active ? 'active' : 'inactive']"><span class="small-dot" />{{ unit.active ? 'Aktif' : 'Nonaktif' }}</span></td></tr></tbody></table></div>
            <footer class="table-footer"><span>{{ visibleUnits.length }} dari {{ units.length }} Unit · Halaman {{ page }}<small>Pencarian dan ringkasan berlaku pada halaman ini.</small></span><nav aria-label="Halaman daftar Unit"><button class="button secondary" :disabled="busy || page === 1" @click="run(() => loadUnits(page - 1))">Sebelumnya</button><button class="button secondary" :disabled="busy || units.length < 50" @click="run(() => loadUnits(page + 1))">Berikutnya<AppIcon name="chevron" :size="14" /></button></nav></footer>
          </section>
          <MasterDataPanel v-if="(view === 'locations' && access.canManageLocations) || (view === 'parties' && access.canManageParties)" :key="view" :tenant-id="access.tenantId" :kind="view === 'locations' ? 'locations' : 'parties'" :can-manage="true" /><AccountingPanel v-if="view === 'accounting' && access.canReadAccounting" :tenant-id="access.tenantId" :can-manage="access.canManageAccounting" :can-close="access.canCloseAccounting" :can-view-all="access.canViewAllAccounting" :assigned-unit-ids="access.grants.filter(g => g.role === 'finance' && g.scope === 'unit' && g.unitId).map(g => g.unitId!)" /><UsersPanel v-if="view === 'users' && access.canManageUsers" :tenant-id="access.tenantId" :current-user-id="userId" @access-changed="run(load)" /><SettingsPanel v-if="view === 'settings' && access.canUpdateOrganization" :tenant-id="access.tenantId" :tenant-name="access.tenantName" @saved="run(load)" /><div class="workspace-footer"><span>EngineDes · BUMDes Platform</span><span><AppIcon name="shield" :size="14" />Akses sesuai peran dan penugasan</span></div>
        </template>
      </main>
    </div>
    <dialog ref="unitDialog" class="unit-dialog" aria-labelledby="new-unit-title" @cancel="busy && $event.preventDefault()"><form @submit.prevent="addUnit"><div class="dialog-heading"><span class="stat-icon green"><AppIcon name="building" /></span><button type="button" class="icon-button" aria-label="Tutup form" :disabled="busy" @click="unitDialog?.close()"><AppIcon name="close" /></button></div><h2 id="new-unit-title">Tambah Unit Usaha</h2><p class="subtext">Buat Unit baru untuk organisasi BUMDes Anda.</p><p v-if="message && !success" role="alert" class="notice error">{{ message }}</p><label class="field">Nama Unit<input v-model="name" required maxlength="160" placeholder="Contoh: Toko Desa" :disabled="busy"></label><label class="field">Kode Unit<input v-model="code" required maxlength="40" placeholder="Contoh: TOKO-01" :disabled="busy"><small>Gunakan kode yang unik dalam BUMDes Anda.</small></label><div class="dialog-actions"><button type="button" class="button secondary" :disabled="busy" @click="unitDialog?.close()">Batal</button><button type="submit" class="button primary" :disabled="busy">{{ busy ? 'Menyimpan…' : 'Simpan Unit' }}<AppIcon name="check" :size="17" /></button></div></form></dialog>
  </div>
</template>
