import { defineEventHandler, getRouterParam, getQuery } from 'h3'
import { authenticated } from '../../../../http/context'
import { listUsers } from '../../../../core/iam/users'
import { smtpConfigured } from '../../../../email/activation'
export default defineEventHandler(event => authenticated(event, getRouterParam(event, 'tenantId'), async (tx, actor) => ({
  users: await listUsers(tx, actor, getQuery(event)), emailConfigured: smtpConfigured(),
})))
