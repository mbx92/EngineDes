import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { account, session, user, verification } from '../database/schema'
import type { Database } from '../database/client'
import { withActor } from '../core/iam/context'

// MBX-5 / IAM-001: platform identities are never a substitute for tenant access.
export function createAuth(db: Database, secret: string, baseURL: string) {
  return betterAuth({
    secret, baseURL,
    telemetry: { enabled: false },
    database: drizzleAdapter(db, { provider: 'pg', schema: { user, session, account, verification } }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, revokeSessionsOnPasswordReset: true },
    session: { expiresIn: 60 * 60 * 24, disableSessionRefresh: true, cookieCache: { enabled: false } },
    databaseHooks: { session: { create: { before: async data => {
      await withActor(db, data.userId, undefined, async () => undefined)
      return { data }
    } } } },
  })
}
