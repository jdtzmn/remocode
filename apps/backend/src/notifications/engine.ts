/**
 * Notification engine.
 *
 * Responsible for:
 * - Fetching latest device activity for the source device
 * - Applying suppression decision matrix
 * - Writing notification_log row (sent | suppressed)
 * - Dispatching push notifications via the push sender when decision is "send"
 */

import { logger } from "../logger"
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
  /**
   * Returns true if a notification has already been logged for this request_id.
   * Used to enforce exactly-once notification per unique open request.
   */
  hasNotificationForRequest: (requestId: string) => Promise<boolean>
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
      const notifLog = logger.child({
        user_id: trigger.userId,
        device_id: trigger.deviceId,
        request_id: trigger.requestId,
        session_id: trigger.sessionId,
        kind: trigger.kind,
      })

      // Dedup check: exactly one notification per unique open request_id.
      // If we've already logged a notification for this request, skip silently.
      try {
        const alreadyNotified = await store.hasNotificationForRequest(trigger.requestId)
        if (alreadyNotified) {
          notifLog.debug("notification skipped: already notified for this request")
          return { decision: "suppress", reason: "already_notified" }
        }
      } catch {
        // Fail-open: if we can't check dedup, proceed with normal evaluation.
        notifLog.warn("notification dedup check failed, proceeding with evaluation")
      }

      let decision: SuppressionDecision

      try {
        const sample = await store.getDeviceActivity(trigger.deviceId)
        decision = decideSuppression(sample)
      } catch {
        // Fail-open: if we can't read activity, default to send.
        notifLog.warn("activity fetch failed, defaulting to send")
        decision = { decision: "send", reason: "activity_fetch_error" }
      }

      notifLog.info("notification decision", {
        notification_decision: decision.decision,
        reason: decision.reason,
      })

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
        notifLog.warn("failed to write notification log entry")
      }

      // Send push notification when decision is "send"
      if (decision.decision === "send" && store.pushSender) {
        try {
          await store.pushSender.sendToUser(trigger.userId, {
            title: notificationPayload.title as string,
            body: notificationPayload.body as string,
            data: (notificationPayload.data ?? {}) as Record<string, unknown>,
          })
          notifLog.info("push notification sent")
        } catch {
          // Push send failure is non-fatal — logged decision still stands.
          notifLog.warn("push notification send failed")
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
