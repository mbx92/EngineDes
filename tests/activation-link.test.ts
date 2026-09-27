import { describe, expect, it } from 'vitest'
import { activationLink } from '../server/core/iam/activation-link'

describe('[MBX-5][IAM-001][NFR-SEC-003] activation link delivery', () => {
  it('keeps recipient and bearer token in the fragment, outside HTTP query/path', () => {
    const data = { userId: 'recipient-id', token: 'test-only-bearer' }
    const link = new URL(activationLink(data, 'https://enginedes.example.test'))
    expect(link.origin).toBe('https://enginedes.example.test')
    expect(link.pathname).toBe('/activate')
    expect(link.search).toBe('')
    expect(new URLSearchParams(link.hash.slice(1)).get('token')).toBe(data.token)
    expect(new URLSearchParams(link.hash.slice(1)).get('user')).toBe(data.userId)
  })
  it('rejects missing origin, non-web protocols and embedded credentials', () => {
    const data = { userId: 'recipient', token: 'test-only' }
    for (const origin of [undefined, 'file:///tmp', 'https://user:secret@example.test']) {
      expect(() => activationLink(data, origin)).toThrow()
    }
  })
})
