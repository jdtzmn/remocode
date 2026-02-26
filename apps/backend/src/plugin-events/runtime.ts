import { runtimeAttentionRequestReducer } from "../attention-requests/runtime"
import { db } from "../db"
import { sessionEvents } from "../db/schema"
import { getOrCreateDeviceIdForUser } from "../devices/repository"
import { runtimeSessionProjectionReducer } from "../session-projections/runtime"
import type { SocketDeltaEmitter } from "../socket/emitter"
import { createPluginEventsIngestService } from "./ingest"

export function createRuntimePluginEventsIngestService(socketEmitter?: SocketDeltaEmitter) {
  return createPluginEventsIngestService({
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
    projectEvent: runtimeSessionProjectionReducer,
    projectAttention: runtimeAttentionRequestReducer,
    socketEmitter,
  })
}

// Default singleton without socket emitter — used when socket server is not available
// (e.g., tests that import this module directly). In production, prefer
// createRuntimePluginEventsIngestService(emitter) from server.ts.
export const runtimePluginEventsIngestService = createRuntimePluginEventsIngestService()
