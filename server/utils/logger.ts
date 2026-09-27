import pino from 'pino'
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'enginedes', environment: process.env.NODE_ENV || 'development',
    release_version: process.env.RELEASE_VERSION || '0.1.0', commit_sha: process.env.COMMIT_SHA || 'unknown' },
  redact: { paths: ['password', 'token', 'secret', 'authorization', 'cookie'], censor: '[REDACTED]' },
})
