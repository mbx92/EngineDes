import { randomUUID } from 'node:crypto'
import { setHeader } from 'h3'
import { logger } from '../utils/logger'
export default defineNitroPlugin(nitro => {
  nitro.hooks.hook('request', event => {
    event.context.requestId = randomUUID()
    event.context.startedAt = performance.now()
    setHeader(event, 'x-request-id', event.context.requestId)
  })
  nitro.hooks.hook('afterResponse', event => {
    // Deliberately exclude URL/query/body/headers and identity payloads.
    logger.info({ request_id: event.context.requestId, correlation_id: event.context.requestId, operation: 'http.request', method: event.method,
      tenant_id: event.context.tenantId, actor_id: event.context.actorId,
      status: event.node.res.statusCode, duration_ms: Math.round(performance.now() - event.context.startedAt) }, 'request completed')
  })
})
