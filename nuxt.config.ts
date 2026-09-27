import tailwindcss from '@tailwindcss/vite'
import { builtinModules, createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// [MBX-5][NFR-MNT-002] Nitro 2 requires Hookable 5's always-Promise hooks.
// Hoisted dev imports otherwise resolve Nuxt's Hookable 6 at the workspace root.
const require = createRequire(import.meta.url)
const nitroRequire = createRequire(require.resolve('nitropack/package.json'))
const nitroHookable = join(dirname(nitroRequire.resolve('hookable')), 'index.mjs')

export default defineNuxtConfig({
  compatibilityDate: '2026-09-27',
  devtools: { enabled: false },
  telemetry: false,
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()], server: { watch: { usePolling: true, interval: 300 } } },
  nitro: {
    alias: { hookable: nitroHookable },
    preset: 'node-server',
    watchOptions: { usePolling: true, interval: 300 },
    // Bundle JS dependencies so the artifact works on exFAT and inside a standalone container.
    externals: { inline: [/.*/] },
    // CommonJS requires Node's default export (e.g. events), not its ESM namespace.
    commonJS: { esmExternals: (id: string) => !id.startsWith('unenv/') && !id.startsWith('node:') && !builtinModules.includes(id) },
  },
  typescript: { strict: true },
  app: { head: { htmlAttrs: { lang: 'id' }, title: 'EngineDes' } },
})
