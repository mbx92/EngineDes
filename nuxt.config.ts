import tailwindcss from '@tailwindcss/vite'
import { builtinModules } from 'node:module'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-27',
  devtools: { enabled: false },
  telemetry: false,
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  nitro: {
    preset: 'node-server',
    // Bundle JS dependencies so the artifact works on exFAT and inside a standalone container.
    externals: { inline: [/.*/] },
    // CommonJS requires Node's default export (e.g. events), not its ESM namespace.
    commonJS: { esmExternals: (id: string) => !id.startsWith('unenv/') && !id.startsWith('node:') && !builtinModules.includes(id) },
  },
  typescript: { strict: true },
  app: { head: { htmlAttrs: { lang: 'id' }, title: 'EngineDes' } },
})
