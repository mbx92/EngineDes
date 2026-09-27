<script setup lang="ts">
const props = defineProps<{ tenantId: string; tenantName: string }>()
const emit = defineEmits<{ saved: [] }>()
const name = ref(props.tenantName), busy = ref(false), message = ref(''), success = ref(false)
// [MBX-5][CFG-001] Present existing settings in keyboard-accessible tabs.
const tabs = ['profile', 'security', 'customer', 'sequence', 'audit'] as const
const tabLabels = { profile: 'Profil BUMDes', security: 'Keamanan akun', customer: 'Customer Policy', sequence: 'Penomoran', audit: 'Audit' }
const activeTab = ref<(typeof tabs)[number]>('profile')
const tabId = useId()
function navigateTabs(event: KeyboardEvent) {
  const index = tabs.indexOf(activeTab.value)
  let next: number
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = tabs.length - 1
  else return
  event.preventDefault()
  activeTab.value = tabs[next]!
  const button = event.currentTarget as HTMLButtonElement
  button.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
}
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
<template>
  <section class="settings-grid">
    <div class="settings-tabs" role="tablist" aria-label="Bagian pengaturan">
      <button
        v-for="tab in tabs" :id="`${tabId}-${tab}-tab`" :key="tab"
        type="button" role="tab" :aria-selected="activeTab === tab"
        :aria-controls="`${tabId}-${tab}-panel`" :tabindex="activeTab === tab ? 0 : -1"
        @click="activeTab = tab" @keydown="navigateTabs"
      >
        <AppIcon :name="tab === 'profile' ? 'building' : 'lock'" :size="17" />
        {{ tabLabels[tab] }}
      </button>
    </div>
    <section
      v-show="activeTab === 'profile'" :id="`${tabId}-profile-panel`"
      class="panel settings-card" role="tabpanel" :aria-labelledby="`${tabId}-profile-tab`" tabindex="0"
    >
      <h2>Profil BUMDes</h2>
      <p class="subtext">Nama organisasi ditampilkan pada ruang kerja Anda.</p>
      <p v-if="message" :class="['notice', success ? 'success' : 'error']" :role="success ? 'status' : 'alert'">{{ message }}</p>
      <form @submit.prevent="save">
        <label class="field">Nama BUMDes<input v-model="name" required maxlength="160" :disabled="busy"></label>
        <button class="button primary" :disabled="busy">{{ busy ? 'Menyimpan…' : 'Simpan profil' }}</button>
      </form>
    </section>
    <div v-for="tab in tabs.filter(item => item !== 'profile')" :id="`${tabId}-${tab}-panel`" :key="tab" v-show="activeTab === tab" role="tabpanel" :aria-labelledby="`${tabId}-${tab}-tab`" tabindex="0">
      <GovernancePanel :tenant-id="tenantId" :section="tab" />
    </div>
  </section>
</template>
