import type { MiddlewareHandler } from "hono"

import type { AuthBindings } from "../auth/types"
import { toApiErrorResponse } from "./errors"

type RateLimitStore = {
  /** Returns the number of requests made so far in the current window. */
  increment(key: string, windowMs: number): number
}

/**
 * Creates an in-memory sliding-window rate limit store.
 *
 * Each key tracks an array of timestamps for requests within the current window.
 * Entries older than `windowMs` are evicted on each increment.
 *
 * This is intentionally simple and single-process. For multi-instance deployments
 * a distributed store (Redis) would be used, but this is sufficient for the MVP.
 */
export function createInMemoryRateLimitStore(): RateLimitStore {
  const windows = new Map<string, number[]>()

  return {
    increment(key: string, windowMs: number): number {
      const now = Date.now()
      const cutoff = now - windowMs

      let timestamps = windows.get(key)
      if (!timestamps) {
        timestamps = []
        windows.set(key, timestamps)
      }

      // Evict timestamps outside the current window
      let start = 0
      while (start < timestamps.length && timestamps[start] < cutoff) {
        start++
      }

      if (start > 0) {
        timestamps.splice(0, start)
      }

      timestamps.push(now)
      return timestamps.length
    },
  }
}

// Singleton in-memory store for the process lifetime
const defaultStore = createInMemoryRateLimitStore()

export type RateLimitOptions = {
  /** Maximum number of requests per window. */
  max: number
  /** Window duration in milliseconds. */
  windowMs: number
  /**
   * Derive the rate-limit key from the request context.
   * Defaults to the authenticated user ID (appAuth or pluginAuth).
   */
  keyFn?: (context: Parameters<MiddlewareHandler<AuthBindings>>[0]) => string | undefined
  /**
   * Store to use. Defaults to the singleton in-memory store.
   * Inject a custom store in tests to avoid cross-test state.
   */
  store?: RateLimitStore
}

/**
 * Hono middleware that enforces a sliding-window rate limit.
 *
 * Throws `RATE_LIMITED` (429) when the limit is exceeded.
 * Adds `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` headers.
 */
export function rateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler<AuthBindings> {
  const store = options.store ?? defaultStore

  return async (context, next) => {
    let key: string | undefined

    if (options.keyFn) {
      key = options.keyFn(context)
    } else {
      // Default: use the first available auth identity
      const appAuth = context.get("appAuth")
      const pluginAuth = context.get("pluginAuth")
      key = appAuth?.userId ?? pluginAuth?.userId
    }

    // If we cannot determine a key (e.g. auth not yet applied), pass through
    if (!key) {
      await next()
      return
    }

    const count = store.increment(key, options.windowMs)
    const remaining = Math.max(0, options.max - count)

    context.header("X-RateLimit-Limit", String(options.max))
    context.header("X-RateLimit-Remaining", String(remaining))

    if (count > options.max) {
      const retryAfterSec = Math.ceil(options.windowMs / 1000)
      context.header("Retry-After", String(retryAfterSec))
      // Return directly instead of throwing so tests without onError still see 429
      return context.json(
        toApiErrorResponse(
          "RATE_LIMITED",
          `Rate limit exceeded. Maximum ${options.max} requests per ${retryAfterSec}s window.`,
        ),
        429,
      )
    }

    await next()
  }
}
