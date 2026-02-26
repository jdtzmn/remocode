import { randomUUID } from "node:crypto"

import { PLUGIN_VERSION } from "./plugin-startup"

export type HeartbeatOptions = {
  backendUrl: string
  pat: string
  deviceUid: string
  /** Callback to get the current list of active session IDs */
  getActiveSessionIds: () => string[]
  /** Interval in milliseconds. Defaults to 15000 (15s). */
  intervalMs?: number
}

export type HeartbeatHandle = {
  /** Stop the heartbeat timer */
  stop: () => void
}

type HeartbeatPayload = {
  uptime_sec: number
  active_session_ids: string[]
  queue_depth: number
}

/**
 * Sends a single plugin.heartbeat event to the backend via HTTP POST /v1/plugin/events.
 * Returns the response status for testing/observability.
 */
export async function sendHeartbeat(options: {
  backendUrl: string
  pat: string
  deviceUid: string
  uptimeSec: number
  activeSessionIds: string[]
  queueDepth?: number
}): Promise<void> {
  const { pat, deviceUid, uptimeSec, activeSessionIds } = options
  const backendUrl = options.backendUrl.replace(/\/$/, "")
  const queueDepth = options.queueDepth ?? 0

  const payload: HeartbeatPayload = {
    uptime_sec: uptimeSec,
    active_session_ids: activeSessionIds,
    queue_depth: queueDepth,
  }

  const event = {
    event_id: randomUUID(),
    adapter: "opencode",
    adapter_version: PLUGIN_VERSION,
    device_uid: deviceUid,
    event_type: "plugin.heartbeat",
    occurred_at: new Date().toISOString(),
    payload,
  }

  const response = await fetch(`${backendUrl}/v1/plugin/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({ events: [event] }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error")
    throw new Error(`Failed to send plugin.heartbeat: ${response.status} ${errorText}`)
  }
}

/**
 * Starts a repeating heartbeat timer that emits plugin.heartbeat events
 * every intervalMs milliseconds (default: 15000ms).
 *
 * Returns a handle to stop the timer.
 * Errors during individual heartbeat sends are logged but do not stop the timer.
 */
export function startHeartbeat(options: HeartbeatOptions): HeartbeatHandle {
  const { backendUrl, pat, deviceUid, getActiveSessionIds, intervalMs = 15000 } = options

  const startedAt = Date.now()

  const timerId = setInterval(async () => {
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000)
    const activeSessionIds = getActiveSessionIds()

    try {
      await sendHeartbeat({
        backendUrl,
        pat,
        deviceUid,
        uptimeSec,
        activeSessionIds,
      })
    } catch (err) {
      console.error("[remocode] Failed to send heartbeat:", err)
    }
  }, intervalMs)

  // Allow Node.js to exit even if the timer is still running
  if (timerId.unref) {
    timerId.unref()
  }

  return {
    stop: () => clearInterval(timerId),
  }
}

/**
 * Tracks active session IDs based on session lifecycle events.
 * Sessions are added on session.created and removed on session.deleted.
 */
export class SessionTracker {
  private activeSessions = new Set<string>()

  /**
   * Call this when a session is created or becomes active.
   */
  addSession(sessionId: string): void {
    this.activeSessions.add(sessionId)
  }

  /**
   * Call this when a session is deleted or closed.
   */
  removeSession(sessionId: string): void {
    this.activeSessions.delete(sessionId)
  }

  /**
   * Returns a snapshot of the current active session IDs.
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.activeSessions)
  }
}
