/**
 * Logger centralizado com níveis (substitui console.log)
 * Níveis: debug < info < warn < error
 * Controlado via LOG_LEVEL env var (default: info)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (env in LEVEL_PRIORITY) return env as LogLevel;
  return 'info';
}

const configuredLevel = getConfiguredLevel();
const configuredPriority = LEVEL_PRIORITY[configuredLevel];

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, module: string, message: string, meta?: Record<string, unknown>): string {
  const ts = formatTimestamp();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level.toUpperCase()}] [${module}] ${message}${metaStr}`;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= configuredPriority;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export function createLogger(module: string): Logger {
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('debug')) {
        console.debug(formatMessage('debug', module, message, meta));
      }
    },
    info(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('info')) {
        console.log(formatMessage('info', module, message, meta));
      }
    },
    warn(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', module, message, meta));
      }
    },
    error(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('error')) {
        console.error(formatMessage('error', module, message, meta));
      }
    },
  };
}

export const logger = createLogger('App');
