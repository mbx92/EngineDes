import { createError, defineEventHandler, getHeader, getRequestURL, toWebRequest } from 'h3'
import { getAuth } from '../../auth'
// Only the implemented, reviewed endpoints are exposed. No signup/account mutation bypass.
const allowed = new Map([['/api/auth/sign-in/email', 'POST'], ['/api/auth/sign-out', 'POST'], ['/api/auth/get-session', 'GET']])
export default defineEventHandler(async event => {
  if (allowed.get(getRequestURL(event).pathname) !== event.method) throw createError({ statusCode: 404, statusMessage: 'Not found' })
  if (event.method === 'GET' && !getHeader(event, 'cookie')) return Response.json(null)
  return (await getAuth()).handler(toWebRequest(event))
})
