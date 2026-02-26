import { and, eq } from "drizzle-orm"

import { db } from "../db"
import { devices, sessionEvents } from "../db/schema"
import { createPluginEventsIngestService } from "./ingest"

async function getOrCreateDeviceId(args: { userId: string; deviceUid: string }) {
  const existing = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, args.userId), eq(devices.deviceUid, args.deviceUid)))
    .limit(1)

  if (existing.length > 0) {
    return existing[0].id
  }

  const inserted = await db
    .insert(devices)
    .values({
      userId: args.userId,
      deviceUid: args.deviceUid,
    })
    .onConflictDoNothing({
      target: [devices.userId, devices.deviceUid],
    })
    .returning({ id: devices.id })

  if (inserted.length > 0) {
    return inserted[0].id
  }

  const found = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, args.userId), eq(devices.deviceUid, args.deviceUid)))
    .limit(1)

  if (found.length === 0) {
    throw new Error("Unable to resolve device")
  }

  return found[0].id
}

export const runtimePluginEventsIngestService = createPluginEventsIngestService({
  getOrCreateDeviceId,
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
