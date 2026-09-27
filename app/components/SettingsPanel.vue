<script setup lang="ts">
const props = defineProps<{ tenantId: string; tenantName: string }>()
const emit = defineEmits<{ saved: [] }>()
const name = ref(props.tenantName), busy = ref(false), message = ref(''), success = ref(false)
watch(() => props.tenantName, value => { name.value = value })
async function save() {
  busy.value = true; message.value = ''; success.value = false
  try {
    await $fetch('/api/tenants/' + props.tenantId + '/settings', { method: 'PUT', body: { name: name.value } })
    message.value = 'Profil BUMDes berhasil disimpan.'; success.value = true; emit('saved')
  } catch { message.value = 'Profil belum dapat disimpan. Periksa nama dan akses Anda.' }
  finally { busy.value = false }
}
</script>
<template><section class="settings-grid"><section class="panel settings-card"><h2>Profil BUMDes</h2><p class="subtext">Nama organisasi ditampilkan pada ruang kerja Anda.</p><p v-if="message" :class="['notice', success ? 'success' : 'error']" :role="success ? 'status' : 'alert'">{{ message }}</p><form @submit.prevent="save"><label class="field">Nama BUMDes<input v-model="name" required maxlength="160" :disabled="busy"></label><button class="button primary" :disabled="busy">{{ busy ? 'Menyimpan…' : 'Simpan profil' }}</button></form></section><section class="panel settings-card"><h2>Keamanan akun</h2><p class="subtext">Kebijakan yang berlaku saat ini.</p><dl class="policy-list"><div><dt>Masa berlaku sesi</dt><dd>24 jam</dd></div><div><dt>Panjang password minimum</dt><dd>12 karakter</dd></div><div><dt>Pembuatan akun</dt><dd>Oleh admin</dd></div><div><dt>Aktivasi akun</dt><dd>Email atau tautan dari admin · 24 jam · sekali pakai</dd></div><div><dt>Perubahan akses</dt><dd>Berlaku pada request berikutnya</dd></div></dl><p class="subtext">Pengaturan kebijakan keamanan dan MFA belum tersedia untuk diubah.</p></section></section></template>
