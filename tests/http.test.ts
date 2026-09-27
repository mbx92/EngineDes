import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

describe('[MBX-5][IAM-001/002] Nuxt HTTP boundary', async () => {
  await setup({ rootDir: fileURLToPath(new URL('..', import.meta.url)), browser: false })
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
  })
  it('does not expose signup or account mutation bypass endpoints', async () => {
    await expect($fetch('/api/auth/sign-up/email', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 404 })
    await expect($fetch('/api/auth/change-password', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 404 })
  })
})
