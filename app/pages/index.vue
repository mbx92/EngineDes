<script setup lang="ts">
import { createAuthClient } from 'better-auth/vue'

type Unit = { id: string; name: string; code: string; active: boolean }
type Access = { tenantId: string; grants: { role: string; scope: string; unitId: string | null }[]; canCreateUnit: boolean }
const auth = createAuthClient()
const email = ref('')
const password = ref('')
const name = ref('')
const code = ref('')
const access = ref<Access | null>(null)
const units = ref<Unit[]>([])
const busy = ref(false)
const message = ref('')
const signedIn = ref(false)
const ready = ref(false)
const page = ref(1)

async function load() {
  const result = await auth.getSession()
  signedIn.value = !!result.data
  access.value = null
  units.value = []
  if (result.data) {
    access.value = await $fetch<Access>('/api/access')
    units.value = await $fetch<Unit[]>(`/api/tenants/${access.value.tenantId}/units`, { query: { page: page.value } })
  }
}
async function run(operation: () => Promise<void>) {
  busy.value = true
  message.value = ''
  try { await operation() }
  catch { message.value = 'Permintaan belum berhasil. Periksa akses Anda atau coba kembali.' }
  finally { busy.value = false }
}
async function login() {
  await run(async () => {
    const result = await auth.signIn.email({ email: email.value, password: password.value, rememberMe: false })
    password.value = ''
    if (result.error) { message.value = 'Login gagal. Periksa email dan password Anda.'; return }
    page.value = 1
    await load()
  })
}
async function logout() {
  await run(async () => {
    const result = await auth.signOut()
    if (result.error) throw new Error('Logout failed')
    signedIn.value = false
    access.value = null
    units.value = []
  })
}
async function addUnit() {
  if (!access.value) return
  const tenant = access.value.tenantId
  await run(async () => {
    await $fetch(`/api/tenants/${tenant}/units`, { method: 'POST', body: { name: name.value, code: code.value } })
    name.value = ''; code.value = ''
    page.value = 1
    await load()
    message.value = 'Unit berhasil dibuat.'
  })
}
onMounted(async () => { await run(load); ready.value = true })
async function changePage(next: number) { page.value = next; await run(load) }
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-12">
    <header class="mb-8 flex items-center justify-between gap-4">
      <div><p class="text-sm font-semibold text-teal-700">BUMDes Platform</p><h1 class="text-3xl font-bold">EngineDes</h1></div>
      <button v-if="signedIn" class="rounded-lg border px-4 py-2 disabled:opacity-50" :disabled="busy" @click="logout">Keluar</button>
    </header>
    <p v-if="!ready" role="status">Memuat…</p>
    <p v-if="message" role="status" class="mb-6 rounded-lg bg-white p-4">{{ message }}</p>
    <section v-if="ready && !signedIn" class="max-w-md rounded-2xl bg-white p-8 shadow-sm" aria-labelledby="login-title">
      <h2 id="login-title" class="mb-2 text-xl font-semibold">Masuk ke akun Anda</h2>
      <p class="mb-6 text-sm text-slate-600">Gunakan akun yang dibuatkan admin BUMDes.</p>
      <form class="grid gap-4" @submit.prevent="login">
        <label class="grid gap-1">Email<input v-model="email" name="email" type="email" autocomplete="username" required class="rounded-lg border p-3"></label>
        <label class="grid gap-1">Password<input v-model="password" name="password" type="password" autocomplete="current-password" required class="rounded-lg border p-3"></label>
        <button type="submit" :disabled="busy" class="rounded-lg bg-teal-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{{ busy ? 'Memproses…' : 'Masuk' }}</button>
      </form>
    </section>
    <section v-if="access" aria-labelledby="units-title">
      <h2 id="units-title" class="mb-4 text-xl font-semibold">Unit Usaha</h2>
      <p class="mb-6 text-slate-600">Unit yang dapat Anda akses sesuai penugasan.</p>
      <ul class="mb-8 grid gap-4 sm:grid-cols-2">
        <li v-for="unit in units" :key="unit.id" class="rounded-xl bg-white p-6 shadow-sm">
          <h3 class="font-semibold">{{ unit.name }}</h3><p class="mt-1 text-sm text-slate-600">{{ unit.code }} · {{ unit.active ? 'Aktif' : 'Nonaktif' }}</p>
        </li>
      </ul>
      <p v-if="units.length === 0" class="mb-6">Belum ada Unit yang dapat ditampilkan.</p>
      <nav class="mb-6 flex items-center gap-4" aria-label="Halaman daftar Unit">
        <button :disabled="busy || page === 1" class="rounded-lg border px-3 py-2 disabled:opacity-50" @click="changePage(page - 1)">Sebelumnya</button>
        <span>Halaman {{ page }}</span>
        <button :disabled="busy || units.length < 50" class="rounded-lg border px-3 py-2 disabled:opacity-50" @click="changePage(page + 1)">Berikutnya</button>
      </nav>
      <form v-if="access.canCreateUnit" class="grid gap-4 rounded-xl bg-white p-6" @submit.prevent="addUnit">
        <h3 class="font-semibold">Tambah Unit Usaha</h3>
        <label class="grid gap-1">Nama Unit<input v-model="name" required maxlength="160" class="rounded-lg border p-3"></label>
        <label class="grid gap-1">Kode Unit<input v-model="code" required maxlength="40" class="rounded-lg border p-3"></label>
        <button type="submit" :disabled="busy" class="justify-self-start rounded-lg bg-teal-700 px-4 py-3 font-semibold text-white disabled:opacity-50">Simpan Unit</button>
      </form>
    </section>
  </main>
</template>
