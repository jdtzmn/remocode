import { randomUUID } from "node:crypto"

import type { Event } from "@opencode-ai/sdk"

import { PLUGIN_VERSION } from "./plugin-startup"

/**
 * The set of OpenCode event types we track and forward to the backend.
 * NOTE: SDK v1 uses "permission.updated" (not "permission.asked") for permission requests.
 * We map it to the canonical "permission.asked" event type.
 */
const TRACKED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "permission.updated", // SDK v1 equivalent of permission.asked
  "permission.replied",
])

/**
 * Blocker event types that must be flushed immediately (no batching delay).
 * "permission.updated" maps to canonical "permission.asked" which is a blocker.
 */
const BLOCKER_SDK_EVENT_TYPES: ReadonlySet<string> = new Set(["permission.updated"])

/**
 * Canonical blocker event types (for external use / testing).
 */
const BLOCKER_CANONICAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "permission.asked",
  "question.asked",
])

/**
 * A single canonical event envelope ready to send to the backend.
 */
export type CanonicalEventEnvelope = {
  event_id: string
  adapter: string
  adapter_version: string
  device_uid: string
  event_type: string
  session_id?: string
  occurred_at: string
  payload: Record<string, unknown>
}

/**
 * Maps an OpenCode SDK Event to a canonical event envelope.
 * Returns null if the event type is not tracked.
 *
 * Mapping notes (SDK v1 → canonical):
 * - "permission.updated" → "permission.asked" (SDK v1 fires this when a permission is requested)
 * - "permission.replied" → "permission.replied" (field rename: permissionID→requestID, response→reply)
 * - "session.created/updated/deleted/status" → pass-through
 * - "question.*" are not available in SDK v1 — they are skipped
 */
export function mapOpenCodeEvent(
  event: Event,
  deviceUid: string,
  occurredAt: string,
): CanonicalEventEnvelope | null {
  if (!TRACKED_EVENT_TYPES.has(event.type)) {
    return null
  }

  const base = {
    event_id: randomUUID(),
    adapter: "opencode" as const,
    adapter_version: PLUGIN_VERSION,
    device_uid: deviceUid,
    occurred_at: occurredAt,
  }

  switch (event.type) {
    case "session.created":
    case "session.updated":
    case "session.deleted": {
      const i = event.properties.info
      // Pick only the fields defined in SessionInfoSchema to avoid strict() rejections
      // on the backend when the OpenCode SDK adds extra fields to the Session object.
      const info: Record<string, unknown> = {
        id: i.id,
        projectID: i.projectID,
        title: i.title,
        directory: i.directory,
        version: i.version,
        time: i.time,
      }
      // Cast to access optional fields that may exist on newer SDK versions
      const iAny = i as Record<string, unknown>
      if (iAny.slug !== undefined) info.slug = iAny.slug
      if (iAny.parentID !== undefined) info.parentID = iAny.parentID
      if (iAny.summary !== undefined) info.summary = iAny.summary
      if (iAny.share !== undefined) info.share = iAny.share
      if (iAny.revert !== undefined) info.revert = iAny.revert
      return {
        ...base,
        event_type: event.type,
        session_id: i.id,
        payload: { info },
      }
    }

    case "session.status":
      return {
        ...base,
        event_type: "session.status",
        session_id: event.properties.sessionID,
        payload: {
          sessionID: event.properties.sessionID,
          status: event.properties.status,
        },
      }

    case "permission.updated": {
      // SDK v1: "permission.updated" fires when a permission is requested.
      // Maps to canonical "permission.asked".
      const p = event.properties
      return {
        ...base,
        event_type: "permission.asked",
        session_id: p.sessionID,
        payload: {
          id: p.id,
          sessionID: p.sessionID,
          permission: p.type,
          patterns: Array.isArray(p.pattern) ? p.pattern : p.pattern ? [p.pattern] : [],
          metadata: p.metadata ?? {},
          always: [],
          // SDK v1 Permission uses messageID + callID at top level
          ...(p.messageID !== undefined && {
            tool: { messageID: p.messageID, callID: p.callID ?? "" },
          }),
        },
      }
    }

    case "permission.replied": {
      // SDK v1 uses permissionID and response; canonical uses requestID and reply
      const r = event.properties
      return {
        ...base,
        event_type: "permission.replied",
        session_id: r.sessionID,
        payload: {
          sessionID: r.sessionID,
          requestID: r.permissionID,
          reply: r.response,
        },
      }
    }

    default:
      return null
  }
}

/**
 * Checks if a canonical event type is a blocker (permission.asked or question.asked).
 * Exported for testing purposes.
 */
export function isBlockerCanonicalEventType(eventType: string): boolean {
  return BLOCKER_CANONICAL_EVENT_TYPES.has(eventType)
}

/**
 * Checks if an OpenCode SDK event type is a blocker that needs immediate flush.
 */
function isBlockerSdkEventType(eventType: string): boolean {
  return BLOCKER_SDK_EVENT_TYPES.has(eventType)
}

/**
 * Options for the event batch sender.
 */
export type EventBatchSenderOptions = {
  backendUrl: string
  pat: string
  /** Max batch size before forcing a flush. Defaults to 50. */
  maxBatchSize?: number
  /** Max time in milliseconds before flushing pending events. Defaults to 250ms. */
  flushIntervalMs?: number
  /**
   * Max number of events to hold in the pending queue before dropping.
   * Blocker events (permission.asked, question.asked) are NEVER dropped.
   * Oldest non-critical events are dropped first.
   * Defaults to 500.
   */
  maxQueueSize?: number
  /**
   * Max retry attempts for a failed batch send (uses exponential backoff with jitter).
   * Set to 0 to disable retries. Defaults to 3.
   */
  maxRetries?: number
  /**
   * Base delay in milliseconds for retry backoff. Defaults to 1000ms.
   */
  retryBaseDelayMs?: number
  /**
   * Maximum delay in milliseconds for retry backoff. Defaults to 30000ms.
   */
  retryMaxDelayMs?: number
}

/**
 * A handle to the event batch sender for stopping and flushing.
 */
export type EventBatchSenderHandle = {
  /** Queue an event for sending. Blocker events are flushed immediately. */
  enqueue: (envelope: CanonicalEventEnvelope) => void
  /** Flush any pending events immediately. Returns a promise that resolves when done. */
  flush: () => Promise<void>
  /** Stop the background flush timer and flush remaining events. */
  stop: () => Promise<void>
  /** Returns the current number of pending events in the queue. */
  getPendingCount: () => number
}

/**
 * Computes the retry delay with exponential backoff and full jitter.
 * Formula: random(0, min(maxDelay, baseDelay * 2^attempt))
 *
 * @internal exported for testing
 */
export function computeRetryDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
  // Full jitter: uniform random in [0, cap]
  return Math.random() * cap
}

/**
 * Sends a batch of events to the backend with exponential backoff + jitter retry.
 * Throws only after all retries are exhausted.
 *
 * @internal exported for testing
 */
export async function sendEventBatchWithRetry(
  backendUrl: string,
  pat: string,
  events: CanonicalEventEnvelope[],
  maxRetries: number,
  retryBaseDelayMs: number,
  retryMaxDelayMs: number,
): Promise<void> {
  if (events.length === 0) return

  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = computeRetryDelay(attempt - 1, retryBaseDelayMs, retryMaxDelayMs)
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }

    try {
      const response = await fetch(`${backendUrl}/v1/plugin/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pat}`,
        },
        body: JSON.stringify({ events }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error")
        throw new Error(`Failed to send event batch: ${response.status} ${errorText}`)
      }

      // Success — exit retry loop
      return
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        console.warn(
          `[remocode] Event batch send attempt ${attempt + 1}/${maxRetries + 1} failed, retrying:`,
          lastError.message,
        )
      }
    }
  }

  throw lastError
}

/**
 * Creates an event batch sender that:
 * - Buffers events in a bounded queue (maxQueueSize, default 500)
 * - Flushes every 250ms or when 50 events accumulate
 * - Immediately flushes blocker events (permission.asked, question.asked)
 * - Retries failed sends with exponential backoff + jitter (up to maxRetries=3)
 * - On queue overflow, drops oldest non-critical events first; NEVER drops blocker events
 * - Logs errors but does not throw (non-fatal)
 *
 * Per spec §13.4: immediate flush for blocker events, batch otherwise.
 * Per spec §13.6: exponential reconnect (handled by socket), HTTP retry with jitter,
 *   bounded memory queue, never drop blocker events before reporting overflow.
 */
export function createEventBatchSender(options: EventBatchSenderOptions): EventBatchSenderHandle {
  const {
    pat,
    maxBatchSize = 50,
    flushIntervalMs = 250,
    maxQueueSize = 500,
    maxRetries = 3,
    retryBaseDelayMs = 1000,
    retryMaxDelayMs = 30000,
  } = options
  const backendUrl = options.backendUrl.replace(/\/$/, "")

  const pendingEvents: CanonicalEventEnvelope[] = []
  let currentFlushChain: Promise<void> = Promise.resolve()

  /**
   * Enforce the queue size cap by dropping oldest non-critical events.
   * Blocker events are NEVER dropped; they are preserved by moving them
   * to the front if necessary.
   */
  const enforceQueueCap = (): void => {
    if (pendingEvents.length <= maxQueueSize) return

    const overflow = pendingEvents.length - maxQueueSize

    // Find indices of non-blocker events (oldest first = lowest index first)
    const nonBlockerIndices: number[] = []
    for (let i = 0; i < pendingEvents.length; i++) {
      const evt = pendingEvents[i]
      if (evt && !isBlockerCanonicalEventType(evt.event_type)) {
        nonBlockerIndices.push(i)
      }
    }

    const toDrop = Math.min(overflow, nonBlockerIndices.length)

    if (toDrop > 0) {
      // Remove the oldest non-blocker events (lowest indices).
      // We sort indices in descending order so that splicing higher indices
      // first does not affect the position of lower indices.
      const indicesToRemove = nonBlockerIndices.slice(0, toDrop).sort((a, b) => b - a)
      for (const idx of indicesToRemove) {
        pendingEvents.splice(idx, 1)
      }

      console.warn(
        `[remocode] Queue overflow: dropped ${toDrop} non-critical event(s) to stay within maxQueueSize=${maxQueueSize}. ` +
          `Current queue: ${pendingEvents.length} events.`,
      )
    } else if (overflow > 0) {
      // All remaining events are blockers — cannot drop any
      console.warn(
        `[remocode] Queue overflow: ${overflow} excess event(s) cannot be dropped (all are blocker events). ` +
          `Queue size: ${pendingEvents.length}.`,
      )
    }
  }

  const doFlush = async (): Promise<void> => {
    if (pendingEvents.length === 0) return

    const batch = pendingEvents.splice(0, pendingEvents.length)

    try {
      await sendEventBatchWithRetry(
        backendUrl,
        pat,
        batch,
        maxRetries,
        retryBaseDelayMs,
        retryMaxDelayMs,
      )
    } catch (err) {
      console.error("[remocode] Failed to send event batch after retries:", err)
      // Events are dropped after all retries exhausted; spec: fail-fast, no offline queue
    }
  }

  const flush = (): Promise<void> => {
    // Chain flushes to avoid concurrent sends that could reorder events
    currentFlushChain = currentFlushChain.then(() => doFlush())
    return currentFlushChain
  }

  const timerId = setInterval(() => {
    if (pendingEvents.length > 0) {
      flush().catch((err) => {
        console.error("[remocode] Flush timer error:", err)
      })
    }
  }, flushIntervalMs)

  if (timerId.unref) {
    timerId.unref()
  }

  const enqueue = (envelope: CanonicalEventEnvelope): void => {
    pendingEvents.push(envelope)

    // Enforce the bounded queue cap — drop oldest non-critical events if needed
    enforceQueueCap()

    const isBlocker = isBlockerCanonicalEventType(envelope.event_type)
    const isBatchFull = pendingEvents.length >= maxBatchSize

    if (isBlocker || isBatchFull) {
      flush().catch((err) => {
        console.error("[remocode] Enqueue flush error:", err)
      })
    }
  }

  const stop = async (): Promise<void> => {
    clearInterval(timerId)
    await flush()
  }

  const getPendingCount = (): number => pendingEvents.length

  return { enqueue, flush, stop, getPendingCount }
}

/**
 * Creates an OpenCode event handler that maps events to canonical envelopes
 * and enqueues them for batch sending.
 *
 * Returns a function suitable for use as the plugin's `event` hook.
 */
export function createEventForwarder(options: {
  backendUrl: string
  pat: string
  deviceUid: string
  sender: EventBatchSenderHandle
}): (input: { event: Event }) => Promise<void> {
  const { deviceUid, sender } = options

  return async ({ event }) => {
    const occurredAt = new Date().toISOString()
    const envelope = mapOpenCodeEvent(event, deviceUid, occurredAt)

    if (envelope === null) {
      // Event type not tracked — skip silently
      return
    }

    // For immediate flush on blockers, we use the sender's enqueue
    // which detects blocker canonical types and flushes immediately
    sender.enqueue(envelope)
  }
}

// Re-export for use in index.ts
export { isBlockerSdkEventType }
