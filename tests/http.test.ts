import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { setup, $fetch, fetch as fetchResponse } from '@nuxt/test-utils/e2e'

describe('[MBX-5][IAM-001/002] Nuxt HTTP boundary', async () => {
  await setup({ rootDir: fileURLToPath(new URL('..', import.meta.url)), browser: false, env: { BETTER_AUTH_URL: 'http://localhost:3000', BETTER_AUTH_TRUSTED_ORIGINS: 'http://192.168.77.201:3000' } })
  it('serves the login page and liveness without database credentials', async () => {
    expect(await $fetch('/api/health')).toEqual({ status: 'ok' })
    expect(await $fetch('/api/auth/get-session')).toBeNull()
    expect(await $fetch('/')).toContain('EngineDes')
  })
  it('rejects unauthenticated access on the real Unit endpoint', async () => {
    await expect($fetch('/api/tenants/00000000-0000-4000-8000-000000000001/units')).rejects.toMatchObject({ status: 401 })
  })
  it('rejects missing/foreign Origin before any Unit mutation', async () => {
    await expect($fetch('/api/tenants/00000000-0000-4000-8000-000000000001/units', { method: 'POST', body: { name: 'Denied', code: 'X' } })).rejects.toMatchObject({ status: 403 })
    await expect($fetch('/api/tenants/00000000-0000-4000-8000-000000000001/units', { method: 'POST', headers: { origin: 'http://evil.example:3000' }, body: {} })).rejects.toMatchObject({ status: 403 })
    await expect($fetch('/api/tenants/00000000-0000-4000-8000-000000000001/units', { method: 'POST', headers: { origin: 'http://192.168.77.201:3000' }, body: {} })).rejects.toMatchObject({ status: 401 })
  })
  it('does not expose signup or account mutation bypass endpoints', async () => {
    await expect($fetch('/api/auth/sign-up/email', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 404 })
    await expect($fetch('/api/auth/change-password', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 404 })
  })
  it('[IAM-001/002] direct-link endpoint rejects missing Origin and unauthenticated requests without caching', async () => {
    const path = '/api/tenants/00000000-0000-4000-8000-000000000001/users/00000000-0000-4000-8000-000000000011/activation-link'
    const response = await fetchResponse(path, { method: 'POST' })
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect($fetch(path, { method: 'POST', headers: { origin: 'http://localhost:3000' } })).rejects.toMatchObject({ status: 401 })
  })
  it('[IAM-001/002][CFG-001] protects user/settings APIs and activation Origin', async () => {
    await expect($fetch('/api/tenants/00000000-0000-4000-8000-000000000001/users')).rejects.toMatchObject({ status: 401 })
    await expect($fetch('/api/tenants/00000000-0000-4000-8000-000000000001/settings', { method: 'PUT', body: { name: 'Denied' } })).rejects.toMatchObject({ status: 403 })
    await expect($fetch('/api/activate', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 403 })
  })
  it('[PARTY-001][ORG-002][CFG-001][AUDIT-001] protects foundation APIs before accessing tenant data', async () => {
    const root = '/api/tenants/00000000-0000-4000-8000-000000000001/'
    for (const resource of ['parties','locations','configurations','audit']) {
      await expect($fetch(root + resource)).rejects.toMatchObject({ status:401 })
      if (resource !== 'audit') await expect($fetch(root + resource,{method:'POST',body:{}})).rejects.toMatchObject({status:403})
    }
    await expect($fetch(root + 'parties/00000000-0000-4000-8000-000000000011',{method:'PUT',body:{}})).rejects.toMatchObject({status:403})
  })
})
