<script setup lang="ts">
const userId = ref(''), token = ref(''), password = ref(''), confirmation = ref('')
const busy = ref(false), activated = ref(false), message = ref('')
onMounted(() => {
  const params = new URLSearchParams(window.location.hash.slice(1))
  userId.value = params.get('user') || ''; token.value = params.get('token') || ''
  window.history.replaceState(null, '', window.location.pathname)
})
async function activate() {
  message.value = ''
  if (password.value !== confirmation.value) { message.value = 'Konfirmasi password belum sama.'; return }
  busy.value = true
  try {
    await $fetch('/api/activate', { method: 'POST', body: { userId: userId.value, token: token.value, password: password.value } })
    activated.value = true; token.value = ''; password.value = ''; confirmation.value = ''
  } catch { message.value = 'Aktivasi belum berhasil. Periksa password atau minta admin mengirim ulang undangan.' }
  finally { busy.value = false }
}
</script>
<template><main class="activation-screen"><section class="panel activation-card"><span class="brand-mark"><AppIcon name="leaf" /></span><h1>{{ activated ? 'Akun siap digunakan' : 'Aktivasi akun EngineDes' }}</h1><p class="subtext">{{ activated ? 'Password berhasil dibuat. Silakan masuk ke ruang kerja Anda.' : 'Buat password pribadi Anda. Tautan berlaku 24 jam dan hanya dapat digunakan sekali.' }}</p><NuxtLink v-if="activated" to="/" class="button primary">Masuk ke dashboard<AppIcon name="arrow" :size="17" /></NuxtLink><form v-else-if="token && userId" class="login-form" @submit.prevent="activate"><p v-if="message" role="alert" class="notice error">{{ message }}</p><label class="field">Password baru<input v-model="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required :disabled="busy"><small>Minimal 12 karakter. Gunakan password yang hanya Anda ketahui.</small></label><label class="field">Konfirmasi password<input v-model="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" required :disabled="busy"></label><button class="button primary" :disabled="busy">{{ busy ? 'Mengaktivasi…' : 'Aktifkan akun' }}</button></form><p v-else role="status" class="subtext">Buka halaman ini melalui tautan aktivasi dari email Anda.</p></section></main></template>
