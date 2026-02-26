import {
  type CanonicalEvent,
  CanonicalEventSchema,
  type PluginEventsIngestResponse,
  PluginEventsIngestResponseSchema,
  UuidSchema,
} from "@remocode/contracts"
import { z } from "zod"

import { ApiHttpError } from "../http/errors"
import type { SessionProjectionReducer } from "../session-projections/reducer"

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

type PersistedEventStore = {
  getOrCreateDeviceId: (args: { userId: string; deviceUid: string }) => Promise<string>
  persistEvent: (input: PersistInput) => Promise<PersistResult>
  projectEvent?: SessionProjectionReducer
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
          throw new ApiHttpError("INVALID_PAYLOAD", {
            details: {
              issues: eventParse.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            },
          })
        }

        errors.push({
          event_id: eventId,
          code: "INVALID_PAYLOAD",
          message: "Invalid payload",
        })
        continue
      }

      const event = eventParse.data
      let deviceId = deviceIdByUid.get(event.device_uid)

      if (!deviceId) {
        deviceId = await store.getOrCreateDeviceId({
          userId,
          deviceUid: event.device_uid,
        })
        deviceIdByUid.set(event.device_uid, deviceId)
      }

      try {
        const persistResult = await store.persistEvent({
          userId,
          deviceId,
          event,
        })

        if (persistResult === "deduped") {
          deduped += 1
        } else {
          accepted += 1

          if (store.projectEvent) {
            await store.projectEvent({
              event,
              userId,
              deviceId,
              receivedAt: new Date(),
            })
          }
        }
      } catch {
        errors.push({
          event_id: event.event_id,
          code: "INTERNAL_ERROR",
          message: "Unable to persist event",
        })
      }
    }

    return PluginEventsIngestResponseSchema.parse({
      accepted,
      deduped,
      errors,
    })
  }
}
