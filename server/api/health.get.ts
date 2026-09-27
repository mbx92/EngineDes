import { defineEventHandler } from 'h3'
// Liveness only. This does not claim database readiness or expose credentials.
export default defineEventHandler(() => ({ status: 'ok' }))
