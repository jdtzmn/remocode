import { db } from "../db"
import { sessionEvents } from "../db/schema"
import { getOrCreateDeviceIdForUser } from "../devices/repository"
import { createPluginEventsIngestService } from "./ingest"

export const runtimePluginEventsIngestService = createPluginEventsIngestService({
  getOrCreateDeviceId: getOrCreateDeviceIdForUser,
  persistEvent: async ({ userId, deviceId, event }) => {
    const inserted = await db
      .insert(sessionEvents)
      .values({
        eventId: event.event_id,
        userId,
        deviceId,
        adapter: event.adapter,
        adapterVersion: event.adapter_version,
        eventType: event.event_type,
        sessionId: event.session_id,
        occurredAt: new Date(event.occurred_at),
        payload: event.payload,
      })
      .onConflictDoNothing({ target: sessionEvents.eventId })
      .returning({ id: sessionEvents.id })

    return inserted.length === 0 ? "deduped" : "accepted"
  },
})
