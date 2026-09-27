import assert from 'node:assert/strict'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

// MBX-5: verify the production artifact cannot rely on workspace node_modules.
const root = await mkdtemp(join(tmpdir(), 'enginedes-artifact-'))
let child
try {
  await cp(resolve('.output'), join(root, '.output'), { recursive: true })
  child = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: root, windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = '', errors = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { errors += data })
  child.on('error', error => { errors += error.message })
  const deadline = Date.now() + 15000
  while (!/Listening on http:\/\/127\.0\.0\.1:\d+/.test(output) && Date.now() < deadline && child.exitCode === null) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const url = output.match(/Listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]
  assert.ok(url, `Artifact did not start: ${errors}`)
  const health = await fetch(`${url}/api/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })
  assert.equal((await fetch(`${url}/`)).status, 200)
  assert.equal((await fetch(`${url}/api/tenants/00000000-0000-4000-8000-000000000001/units`)).status, 401)
  const session = await fetch(`${url}/api/auth/get-session`)
  assert.equal(session.status, 200)
  assert.equal(await session.json(), null)
  assert.equal((await fetch(`${url}/api/auth/sign-up/email`, { method: 'POST' })).status, 404)
  console.info('[MBX-5] Isolated production artifact smoke: PASS (health, page, auth/session and access denial)')
} finally {
  if (child?.exitCode === null) { const closed = once(child, 'close'); child.kill(); await closed }
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('enginedes-artifact-')) {
    throw new Error('Unsafe temporary cleanup path')
  }
  await rm(root, { recursive: true, force: true })
}
