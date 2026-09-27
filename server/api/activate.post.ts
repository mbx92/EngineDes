import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { requireSameOrigin } from '../http/context'
import { getDatabase, verifyRuntimeRole } from '../database/client'
import { activateAccount } from '../core/iam/activation'
import { AccessDenied } from '../core/iam/access'
export default defineEventHandler(async event => {
  requireSameOrigin(event)
  await verifyRuntimeRole()
  try { return await activateAccount(getDatabase(), await readBody(event), event.context.requestId) }
  catch (error) {
    if (error instanceof z.ZodError || error instanceof AccessDenied) throw createError({ statusCode: 400, statusMessage: 'Tautan aktivasi tidak valid atau kedaluwarsa.' })
    throw error
  }
})
