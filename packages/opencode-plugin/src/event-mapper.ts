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
    case "session.deleted":
      return {
        ...base,
        event_type: event.type,
        session_id: event.properties.info.id,
        payload: { info: event.properties.info },
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
}

/**
 * Sends a batch of events to the backend.
 */
async function sendEventBatch(
  backendUrl: string,
  pat: string,
  events: CanonicalEventEnvelope[],
): Promise<void> {
  if (events.length === 0) return

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
}

/**
 * Creates an event batch sender that:
 * - Buffers events and flushes every 250ms or when 50 events accumulate
 * - Immediately flushes blocker events (permission.asked, question.asked)
 * - Logs errors but does not throw (non-fatal)
 *
 * Per spec §13.4: immediate flush for blocker events, batch otherwise.
 */
export function createEventBatchSender(options: EventBatchSenderOptions): EventBatchSenderHandle {
  const { pat, maxBatchSize = 50, flushIntervalMs = 250 } = options
  const backendUrl = options.backendUrl.replace(/\/$/, "")

  const pendingEvents: CanonicalEventEnvelope[] = []
  let currentFlushChain: Promise<void> = Promise.resolve()

  const doFlush = async (): Promise<void> => {
    if (pendingEvents.length === 0) return

    const batch = pendingEvents.splice(0, pendingEvents.length)

    try {
      await sendEventBatch(backendUrl, pat, batch)
    } catch (err) {
      console.error("[remocode] Failed to send event batch:", err)
      // Events are dropped on failure; per spec, no offline queue for non-critical events
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

  return { enqueue, flush, stop }
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
