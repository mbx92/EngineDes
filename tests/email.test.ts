import nodemailer from 'nodemailer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverActivation } from '../server/email/activation'
describe('[MBX-5][IAM-001][NFR-SEC-003] activation delivery boundary', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
  const delivery = { email: 'recipient@example.test', userId: '00000000-0000-4000-8000-000000000001', token: 'test-only-activation-token' }
  function configure() {
    vi.stubEnv('SMTP_HOST', 'smtp.example.test'); vi.stubEnv('SMTP_FROM', 'admin@example.test')
    vi.stubEnv('SMTP_USER', 'test-user'); vi.stubEnv('SMTP_PASSWORD', 'test-only-password')
    vi.stubEnv('SMTP_PORT', '587'); vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
  }
  it('reports missing sender configuration without sending or exposing a link', async () => {
    vi.stubEnv('SMTP_HOST', '')
    const transport = vi.spyOn(nodemailer, 'createTransport')
    expect(await deliverActivation(delivery)).toEqual({ emailDelivery: 'not_configured' })
    expect(transport).not.toHaveBeenCalled()
  })
  it('requires TLS, disables content logging and returns delivery status only', async () => {
    configure()
    const sendMail = vi.fn().mockResolvedValue({ accepted: [delivery.email] })
    const transport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never)
    expect(await deliverActivation(delivery)).toEqual({ emailDelivery: 'sent' })
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ requireTLS: true, debug: false, logger: false, disableFileAccess: true, disableUrlAccess: true }))
    const mail = sendMail.mock.calls[0]![0]
    expect(mail.to).toBe(delivery.email)
    const link = new URL(mail.text.split('\n\n')[1])
    expect(link.search).toBe('')
    expect(link.hash).toContain('token=')
  })
  it('does not expose transport errors, recipient data or token on failure', async () => {
    configure()
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: vi.fn().mockRejectedValue(new Error('private delivery payload')) } as never)
    expect(await deliverActivation(delivery)).toEqual({ emailDelivery: 'failed' })
  })
})
