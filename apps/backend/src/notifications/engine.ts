/**
 * Notification engine.
 *
 * Responsible for:
 * - Fetching latest device activity for the source device
 * - Applying suppression decision matrix
 * - Writing notification_log row (sent | suppressed)
 * - Dispatching push notifications via the push sender when decision is "send"
 */

import type { PushSender } from "./push-sender"
import type { ActivitySample, SuppressionDecision } from "./suppression"
import { decideSuppression } from "./suppression"

export type NotificationTrigger = {
  requestId: string
  sessionId: string
  deviceId: string
  userId: string
  kind: "permission" | "question"
  /** Human-readable session title for notification payload. */
  sessionTitle: string | null
  /** Device name for notification body. */
  deviceName: string | null
}

export type NotificationLogEntry = {
  userId: string
  deviceId: string
  requestId: string
  decision: "sent" | "suppressed"
  reason: string
  payload: Record<string, unknown>
}

export type NotificationEngineStore = {
  getDeviceActivity: (deviceId: string) => Promise<ActivitySample | null>
  logNotification: (entry: NotificationLogEntry) => Promise<void>
  /** Optional push sender — if omitted, no push is sent (useful for testing). */
  pushSender?: PushSender
}

export type NotificationEngine = {
  /**
   * Evaluate whether to send a push notification for a new open blocker request.
   * Writes a notification_log row.  Returns the suppression decision.
   *
   * Does NOT throw — errors are caught and treated as "send" (fail-open).
   */
  handleBlocker: (trigger: NotificationTrigger) => Promise<SuppressionDecision>
}

export function createNotificationEngine(store: NotificationEngineStore): NotificationEngine {
  return {
    handleBlocker: async (trigger) => {
      let decision: SuppressionDecision

      try {
        const sample = await store.getDeviceActivity(trigger.deviceId)
        decision = decideSuppression(sample)
      } catch {
        // Fail-open: if we can't read activity, default to send.
        decision = { decision: "send", reason: "activity_fetch_error" }
      }

      const notificationPayload = buildNotificationPayload(trigger)

      try {
        await store.logNotification({
          userId: trigger.userId,
          deviceId: trigger.deviceId,
          requestId: trigger.requestId,
          decision: decision.decision === "suppress" ? "suppressed" : "sent",
          reason: decision.reason,
          payload: notificationPayload,
        })
      } catch {
        // Log failure is non-fatal — decision still stands.
      }

      // Send push notification when decision is "send"
      if (decision.decision === "send" && store.pushSender) {
        try {
          await store.pushSender.sendToUser(trigger.userId, {
            title: notificationPayload.title as string,
            body: notificationPayload.body as string,
            data: (notificationPayload.data ?? {}) as Record<string, unknown>,
          })
        } catch {
          // Push send failure is non-fatal — logged decision still stands.
        }
      }

      return decision
    },
  }
}

function buildNotificationPayload(trigger: NotificationTrigger): Record<string, unknown> {
  const title = trigger.sessionTitle ? `Action needed: ${trigger.sessionTitle}` : "Action needed"

  const kindLabel = trigger.kind === "permission" ? "Permission request" : "Question"
  const body = trigger.deviceName ? `${kindLabel} on ${trigger.deviceName}` : kindLabel

  return {
    title,
    body,
    data: {
      request_id: trigger.requestId,
      session_id: trigger.sessionId,
      device_id: trigger.deviceId,
      kind: trigger.kind,
    },
  }
}
