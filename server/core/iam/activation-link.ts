// MBX-5 / IAM-001, NFR-SEC-003: bearer tokens stay out of HTTP URL queries.
export function activationLink(data: { userId: string; token: string }, baseURL: string | undefined) {
  if (!baseURL) throw new Error('Activation origin is not configured')
  const url = new URL('/activate', baseURL)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid activation origin')
  url.hash = new URLSearchParams({ user: data.userId, token: data.token }).toString()
  return url.toString()
}
