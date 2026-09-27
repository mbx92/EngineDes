import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { authenticated, requireSameOrigin } from '../../../../../http/context'
import { issueManualActivation } from '../../../../../core/iam/users'
import { activationLink } from '../../../../../core/iam/activation-link'
// MBX-5 / IAM-001/002, AUDIT-001: only current tenant Admin can obtain this link.
export default defineEventHandler(async event => {
  setHeader(event, 'cache-control', 'no-store')
  setHeader(event, 'pragma', 'no-cache')
  requireSameOrigin(event)
  const baseURL = process.env.BETTER_AUTH_URL
  const delivery = await authenticated(event, getRouterParam(event, 'tenantId'), (tx, actor) => {
    activationLink({ userId: '', token: '' }, baseURL) // Validate config before invalidating an existing token.
    return issueManualActivation(tx, actor, getRouterParam(event, 'userId') || '', event.context.requestId)
  })
  return { activationUrl: activationLink(delivery, baseURL), expiresInHours: 24 }
})
