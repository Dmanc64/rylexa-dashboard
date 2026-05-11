/**
 * Structured logging utility for Rylexa PM Dashboard.
 *
 * All application errors and significant events should go through this module.
 * Currently outputs to console with structured metadata.
 *
 * Future: Replace the transport with Sentry, LogRocket, or a Supabase edge function
 * that writes to system_activity or an external logging service.
 *
 * Usage:
 *   import { logger } from '@/lib/logger'
 *   logger.error('Failed to load leases', { component: 'useLeases', error })
 *   logger.warn('Slow query detected', { table: 'properties', duration: 3200 })
 *   logger.info('User logged in', { userId: user.id, role: profile.role })
 */

type LogLevel = 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  context?: Record<string, unknown>
}

function createLogEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
  }
}

function transport(entry: LogEntry) {
  // Current transport: structured console output.
  // Future: POST to /api/log or Sentry.captureException()
  const method = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'log'
  console[method](`[Rylexa:${entry.level.toUpperCase()}]`, entry.message, entry.context ?? '')
}

export const logger = {
  info(message: string, context?: Record<string, unknown>) {
    transport(createLogEntry('info', message, context))
  },

  warn(message: string, context?: Record<string, unknown>) {
    transport(createLogEntry('warn', message, context))
  },

  error(message: string, context?: Record<string, unknown>) {
    transport(createLogEntry('error', message, context))
  },
}
