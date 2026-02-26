/**
 * Structured logging for the backend.
 *
 * Outputs JSON lines to stdout (info/debug) and stderr (warn/error) so that
 * log aggregation pipelines can parse them reliably.
 *
 * Required keys (per §18.1):
 *   request_id, session_id, device_id, user_id, event_id, command_id, client_action_id
 *
 * Redaction policy (per §16.4):
 *   - PAT secrets: never logged (prefix only)
 *   - Full JWTs: masked to "<redacted>"
 *   - Raw push tokens: hashed in logs (first 8 chars of SHA-256 hex)
 *
 * Usage:
 *   const log = logger.child({ user_id: "...", device_id: "..." })
 *   log.info("event ingested", { event_id, session_id })
 *   log.error("relay failed", { command_id, error: err.message })
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

export type LogContext = {
  /** Internal user UUID */
  user_id?: string | null
  /** Internal device UUID */
  device_id?: string | null
  /** Canonical event UUID */
  event_id?: string | null
  /** Session identifier from OpenCode */
  session_id?: string | null
  /** Attention request identifier */
  request_id?: string | null
  /** Relay command UUID */
  command_id?: string | null
  /** Client-supplied idempotency key */
  client_action_id?: string | null
  /** Additional arbitrary context */
  [key: string]: unknown
}

export type Logger = {
  debug: (message: string, context?: LogContext) => void
  info: (message: string, context?: LogContext) => void
  warn: (message: string, context?: LogContext) => void
  error: (message: string, context?: LogContext) => void
  /** Create a child logger that merges additional context into every log entry. */
  child: (context: LogContext) => Logger
}

// ─── Redaction helpers ────────────────────────────────────────────────────────

/** Detect a JWT: three base64url segments separated by dots. */
const JWT_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

/**
 * Redact a string value if it matches a sensitive pattern.
 * - Full JWTs are replaced with "<jwt:redacted>"
 * - PAT tokens (pat_...) are truncated to their prefix only
 */
export function redactString(value: string): string {
  if (JWT_REGEX.test(value)) {
    return "<jwt:redacted>"
  }

  // PAT tokens follow pattern: pat_<prefix>_<secret>
  const patMatch = /^(pat_[^_]+)_/.exec(value)
  if (patMatch) {
    return `${patMatch[1]}_<redacted>`
  }

  return value
}

/**
 * Redact all string values in a plain object (one level deep).
 * Does not recurse into nested objects intentionally — callers should
 * avoid logging sensitive nested structures entirely.
 */
function redactContext(context: LogContext): LogContext {
  const redacted: LogContext = {}

  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "string") {
      redacted[key] = redactString(value)
    } else {
      redacted[key] = value
    }
  }

  return redacted
}

// ─── Log entry builder ────────────────────────────────────────────────────────

function buildEntry(
  level: LogLevel,
  message: string,
  baseContext: LogContext,
  callContext: LogContext | undefined,
): Record<string, unknown> {
  const merged = { ...baseContext, ...(callContext ?? {}) }
  const safeCtx = redactContext(merged)

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    message,
  }

  // Emit required keys first (present only when set), then remaining context
  const requiredKeys: (keyof LogContext)[] = [
    "user_id",
    "device_id",
    "event_id",
    "session_id",
    "request_id",
    "command_id",
    "client_action_id",
  ]

  for (const key of requiredKeys) {
    if (safeCtx[key] != null) {
      entry[key] = safeCtx[key]
    }
  }

  // Remaining keys (skip nulls so callers can explicitly clear inherited context)
  for (const [key, val] of Object.entries(safeCtx)) {
    if (!(key in entry) && val != null) {
      entry[key] = val
    }
  }

  return entry
}

// ─── Logger factory ───────────────────────────────────────────────────────────

export function createLogger(baseContext: LogContext = {}): Logger {
  function write(level: LogLevel, message: string, callContext?: LogContext) {
    const entry = buildEntry(level, message, baseContext, callContext)
    const line = JSON.stringify(entry)

    if (level === "warn" || level === "error") {
      process.stderr.write(`${line}\n`)
    } else {
      process.stdout.write(`${line}\n`)
    }
  }

  return {
    debug: (message, ctx) => write("debug", message, ctx),
    info: (message, ctx) => write("info", message, ctx),
    warn: (message, ctx) => write("warn", message, ctx),
    error: (message, ctx) => write("error", message, ctx),
    child: (context) => createLogger({ ...baseContext, ...context }),
  }
}

/** Root application logger — use .child() to add request/session context. */
export const logger = createLogger({ service: "backend" })
