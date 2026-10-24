import pino, { type Logger, type LoggerOptions } from "pino";
import { redactPii } from "./redact";

/**
 * Field names that may hold personal data, message content or secrets, at any depth of a log
 * entry (security audit M13). Values are replaced with "[redacted]". Prefer logging ids
 * (tenantId, contactId, callId) over personal data.
 */
const SENSITIVE_KEYS = new Set([
  "email",
  "emailaddress",
  "phone",
  "phonee164",
  "callerphone",
  "to",
  "from",
  "password",
  "pass",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "set-cookie",
  "fullname",
  "name",
  "customername",
  "transcript",
  "body",
  "text",
  "content",
  "html",
  "reply",
  "question",
  "answer",
  "message",
  "address",
]);

/** Kept for compatibility (pino's own path redaction, as a second layer). */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

const MAX_DEPTH = 8;

function scrubError(err: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (err instanceof Error) out.type = err.constructor.name;
  for (const key of ["type", "name", "code", "status", "statusCode"]) {
    if (err[key] !== undefined) out[key] = err[key];
  }
  // Drizzle puts the query's parameters in the message ("Failed query: … params: …").
  const clean = (s: unknown) =>
    typeof s === "string" ? redactPii(s.replace(/params:[\s\S]*$/m, "params: [redacted]")) : s;
  if (err.message !== undefined) out.message = clean(err.message);
  if (err.stack !== undefined) out.stack = clean(err.stack);
  if (err.cause && typeof err.cause === "object") {
    out.cause = scrubError(err.cause as Record<string, unknown>);
  }
  return out;
}

/** Deep copy with sensitive fields replaced; error objects keep only safe parts. */
export function scrubLogObject(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => scrubLogObject(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(obj)) {
    if (key === "err" || key === "error" || v instanceof Error) {
      out[key] =
        v && typeof v === "object"
          ? scrubError(v as Record<string, unknown>)
          : redactPii(String(v));
    } else if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = "[redacted]";
    } else {
      out[key] = scrubLogObject(v, depth + 1);
    }
  }
  return out;
}

export function loggerOptions(
  name: string,
  level = process.env.LOG_LEVEL ?? "info",
): LoggerOptions {
  return {
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    serializers: {
      // Errors: pino's standard form, then scrubbed (the log formatter may already have
      // turned them into plain objects, which pass through).
      err: (e: unknown) => (e instanceof Error ? scrubError(pino.stdSerializers.err(e)) : e),
    },
    formatters: {
      log: (object) => scrubLogObject(object) as Record<string, unknown>,
    },
  };
}

export function createLogger(name: string, level?: string): Logger {
  return pino(loggerOptions(name, level));
}

export type { Logger };
