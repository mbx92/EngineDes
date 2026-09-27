import { getDatabase, verifyRuntimeRole } from '../database/client'
import { createAuth } from './options'
let instance: ReturnType<typeof createAuth> | undefined
export async function getAuth() {
  await verifyRuntimeRole()
  if (!instance) {
    const secret = process.env.BETTER_AUTH_SECRET
    const baseURL = process.env.BETTER_AUTH_URL
    if (!secret || secret.length < 32 || !baseURL) throw new Error('Configure BETTER_AUTH_SECRET (32+ characters) and BETTER_AUTH_URL')
    instance = createAuth(getDatabase(), secret, baseURL)
  }
  return instance
}
