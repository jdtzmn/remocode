import {
  type CanonicalEvent,
  CanonicalEventSchema,
  type PluginEventsIngestResponse,
  PluginEventsIngestResponseSchema,
  UuidSchema,
} from "@remocode/contracts"
import { z } from "zod"

import type { AttentionRequestReducer } from "../attention-requests/reducer"
import { ApiHttpError } from "../http/errors"
import { logger } from "../logger"
import type { NotificationEngine } from "../notifications/engine"
import type { SessionProjectionReducer } from "../session-projections/reducer"
import type { SocketDeltaEmitter } from "../socket/emitter"

const PluginEventsEnvelopeSchema = z
  .object({
    events: z.array(z.unknown()).min(1).max(500),
  })
  .strict()

type PersistResult = "accepted" | "deduped"

type PersistInput = {
  userId: string
  deviceId: string
  event: CanonicalEvent
}

// Event types that update session_projections and should trigger a sessions.delta emit
const SESSION_PROJECTION_EVENT_TYPES = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "plugin.heartbeat",
])

// Event types that update attention_requests and should trigger a requests.delta emit
const ATTENTION_REQUEST_EVENT_TYPES = new Set([
  "permission.asked",
  "question.asked",
  "permission.replied",
  "question.replied",
  "question.rejected",
])

// Event types that close attention requests and should trigger a request.resolved emit
const ATTENTION_CLOSE_EVENT_TYPES = new Set([
  "permission.replied",
  "question.replied",
  "question.rejected",
])

// Event types that should trigger a push notification decision
const BLOCKER_EVENT_TYPES = new Set(["permission.asked", "question.asked"])

type PersistedEventStore = {
  getOrCreateDeviceId: (args: { userId: string; deviceUid: string }) => Promise<string>
  persistEvent: (input: PersistInput) => Promise<PersistResult>
  projectEvent?: SessionProjectionReducer
  projectAttention?: AttentionRequestReducer
  socketEmitter?: SocketDeltaEmitter
  notificationEngine?: NotificationEngine
  /** Fetch session title and device name for notification payload construction. */
  getBlockerContext?: (args: {
    sessionId: string
    deviceId: string
  }) => Promise<{ sessionTitle: string | null; deviceName: string | null }>
}

export type PluginEventsIngestService = (args: {
  userId: string
  payload: unknown
}) => Promise<PluginEventsIngestResponse>

function getEventIdFromUnknown(value: unknown) {
  if (!value || typeof value !== "object") {
    return null
  }

  const candidate = (value as Record<string, unknown>).event_id
  const parsed = UuidSchema.safeParse(candidate)

  return parsed.success ? parsed.data : null
}

export function createPluginEventsIngestService(
  store: PersistedEventStore,
): PluginEventsIngestService {
  return async ({ userId, payload }) => {
    const ingestLog = logger.child({ user_id: userId })
    const body = PluginEventsEnvelopeSchema.parse(payload)

    let accepted = 0
    let deduped = 0
    const errors: PluginEventsIngestResponse["errors"] = []
    const deviceIdByUid = new Map<string, string>()

    for (const rawEvent of body.events) {
      const eventParse = CanonicalEventSchema.safeParse(rawEvent)

      if (!eventParse.success) {
        const eventId = getEventIdFromUnknown(rawEvent)

        if (!eventId) {
          ingestLog.warn("event ingest failed: invalid payload without event_id")
          throw new ApiHttpError("INVALID_PAYLOAD", {
            details: {
              issues: eventParse.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            },
          })
        }

        ingestLog.warn("event ingest error: invalid event payload", { event_id: eventId })
        errors.push({
          event_id: eventId,
          code: "INVALID_PAYLOAD",
          message: "Invalid payload",
        })
        continue
      }

      const event = eventParse.data
      const eventLog = ingestLog.child({
        event_id: event.event_id,
        session_id: event.session_id ?? undefined,
        event_type: event.event_type,
      })

      let deviceId = deviceIdByUid.get(event.device_uid)

      if (!deviceId) {
        deviceId = await store.getOrCreateDeviceId({
          userId,
          deviceUid: event.device_uid,
        })
        deviceIdByUid.set(event.device_uid, deviceId)
      }

      const eventWithDeviceLog = eventLog.child({ device_id: deviceId })

      try {
        const persistResult = await store.persistEvent({
          userId,
          deviceId,
          event,
        })

        if (persistResult === "deduped") {
          deduped += 1
          eventWithDeviceLog.debug("event deduped")
        } else {
          accepted += 1
          eventWithDeviceLog.info("event accepted")
          const receivedAt = new Date()

          let sessionProjectionUpdated = false
          let attentionRequestUpdated = false

          if (store.projectEvent) {
            await store.projectEvent({
              event,
              userId,
              deviceId,
              receivedAt,
            })

            if (SESSION_PROJECTION_EVENT_TYPES.has(event.event_type)) {
              sessionProjectionUpdated = true
            }
          }

          if (store.projectAttention) {
            await store.projectAttention({
              event,
              userId,
              deviceId,
              receivedAt,
            })

            if (ATTENTION_REQUEST_EVENT_TYPES.has(event.event_type)) {
              attentionRequestUpdated = true
              // Attention events also update session_projections (attention fields)
              sessionProjectionUpdated = true
            }
          }

          if (store.socketEmitter) {
            if (sessionProjectionUpdated) {
              await store.socketEmitter.emitSessionsDelta(userId)
            }

            if (attentionRequestUpdated) {
              await store.socketEmitter.emitRequestsDelta(userId)

              // Emit request.resolved when a request is closed by a reply/rejected event
              if (ATTENTION_CLOSE_EVENT_TYPES.has(event.event_type)) {
                const requestId = (event.payload as { requestID?: string }).requestID
                if (requestId) {
                  await store.socketEmitter.emitRequestResolved(userId, requestId)
                  eventWithDeviceLog.info("request resolved via event", { request_id: requestId })
                }
              }
            }
          }

          // Push notification decision for new open blockers
          if (
            store.notificationEngine &&
            BLOCKER_EVENT_TYPES.has(event.event_type) &&
            event.session_id
          ) {
            const requestId = (event.payload as { id?: string }).id
            const kind = event.event_type === "permission.asked" ? "permission" : "question"

            if (requestId) {
              eventWithDeviceLog.info("blocker event: triggering notification evaluation", {
                request_id: requestId,
                kind,
              })

              let sessionTitle: string | null = null
              let deviceName: string | null = null

              if (store.getBlockerContext) {
                try {
                  const ctx = await store.getBlockerContext({
                    sessionId: event.session_id,
                    deviceId,
                  })
                  sessionTitle = ctx.sessionTitle
                  deviceName = ctx.deviceName
                } catch {
                  // Non-fatal — proceed with null context
                }
              }

              // Fire-and-forget: notification errors must not fail ingest
              store.notificationEngine
                .handleBlocker({
                  requestId,
                  sessionId: event.session_id,
                  deviceId,
                  userId,
                  kind,
                  sessionTitle,
                  deviceName,
                })
                .catch(() => {
                  // swallow — notification errors must not fail event ingest
                })
            }
          }
        }
      } catch {
        eventWithDeviceLog.error("event ingest error: unable to persist event")
        errors.push({
          event_id: event.event_id,
          code: "INTERNAL_ERROR",
          message: "Unable to persist event",
        })
      }
    }

    ingestLog.info("event batch processed", { accepted, deduped, errors: errors.length })

    return PluginEventsIngestResponseSchema.parse({
      accepted,
      deduped,
      errors,
    })
  }
}
