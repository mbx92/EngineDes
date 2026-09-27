import nodemailer from 'nodemailer'
export function smtpConfigured() { return !!(process.env.SMTP_HOST && process.env.SMTP_FROM && process.env.SMTP_USER && process.env.SMTP_PASSWORD) }
// No password or activation token is returned to the admin UI or logged.
export async function deliverActivation(data: { email: string; userId: string; token: string }) {
  if (!smtpConfigured()) return { emailDelivery: 'not_configured' as const }
  try {
    const port = Number(process.env.SMTP_PORT || 587)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { emailDelivery: 'failed' as const }
    const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true })
    const url = new URL('/activate', process.env.BETTER_AUTH_URL)
    // Fragment keeps bearer tokens out of server requests, query logs and referrers.
    url.hash = new URLSearchParams({ user: data.userId, token: data.token }).toString()
    const result = await transport.sendMail({ from: process.env.SMTP_FROM, to: data.email, subject: 'Aktivasi akun EngineDes', text: 'Aktifkan akun Anda dan buat password melalui tautan berikut (berlaku 24 jam, sekali pakai):\n\n' + url.toString() })
    return { emailDelivery: result.accepted.length ? 'sent' as const : 'failed' as const }
  } catch { return { emailDelivery: 'failed' as const } }
}
