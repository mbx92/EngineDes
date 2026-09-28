import { createError, getHeader, toWebRequest, type H3Event } from 'h3'
import { z } from 'zod'
import { getAuth } from '../auth'
import { getDatabase, type Transaction } from '../database/client'
import { AccessDenied, type ActorAccess } from '../core/iam/access'
import { withActor } from '../core/iam/context'
import { ManagementConflict } from '../core/iam/users'

export function requireSameOrigin(event: H3Event) {
  const configured = process.env.BETTER_AUTH_URL
  const allowed = [configured, ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || '').split(',')]
    .filter((value): value is string => Boolean(value))
    .map(value => { try { return new URL(value).origin } catch { return null } })
    .filter((value): value is string => value !== null)
  const origin = getHeader(event, 'origin')
  if (!origin || !allowed.includes(origin)) {
    throw createError({ statusCode: 403, statusMessage: 'Origin denied' })
  }
}
export async function authenticated<T>(event: H3Event, tenantId: string | undefined,
  operation: (tx: Transaction, actor: ActorAccess) => Promise<T>): Promise<T> {
  if (tenantId && !z.uuid().safeParse(tenantId).success) throw createError({ statusCode: 400, statusMessage: 'Invalid tenant identifier' })
  if (!getHeader(event, 'cookie')) throw createError({ statusCode: 401, statusMessage: 'Login required' })
  const auth = await getAuth()
  const identity = await auth.api.getSession({ headers: toWebRequest(event).headers })
  if (!identity) throw createError({ statusCode: 401, statusMessage: 'Login required' })
  try { return await withActor(getDatabase(), identity.user.id, tenantId, (tx, actor) => {
    event.context.actorId = actor.userId
    event.context.tenantId = actor.tenantId
    return operation(tx, actor)
  }) }
  catch (error) {
    if (error instanceof AccessDenied) throw createError({ statusCode: 403, statusMessage: 'Access denied' })
    if (error instanceof z.ZodError) throw createError({ statusCode: 400, statusMessage: 'Invalid input' })
    if (error instanceof ManagementConflict) throw createError({ statusCode: 409, statusMessage: error.message })
    // PostgreSQL unique violation, including errors wrapped by Drizzle.
    const cause = error as { code?: string; cause?: { code?: string } }
    if (cause.code === '23505' || cause.cause?.code === '23505') throw createError({ statusCode: 409, statusMessage: 'Record already exists' })
    throw error
  }
}
