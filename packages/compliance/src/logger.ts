import pino, { type Logger, type LoggerOptions } from "pino";

/**
 * Structured-log field paths that may hold personal data or secrets. Values are replaced
 * with "[redacted]". Prefer logging ids (tenantId, contactId, callId) over personal data.
 */
export const REDACT_PATHS = [
  "*.email",
  "*.phone",
  "*.phoneE164",
  "*.password",
  "*.token",
  "*.secret",
  "*.apiKey",
  "*.fullName",
  "*.name",
  "*.transcript",
  "*.body",
  "email",
  "phone",
  "password",
  "token",
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

export function loggerOptions(
  name: string,
  level = process.env.LOG_LEVEL ?? "info",
): LoggerOptions {
  return {
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
}

export function createLogger(name: string, level?: string): Logger {
  return pino(loggerOptions(name, level));
}

export type { Logger };
