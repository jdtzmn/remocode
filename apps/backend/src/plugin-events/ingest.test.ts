import { describe, expect, it } from "vitest"

import { ApiHttpError } from "../http/errors"
import { createPluginEventsIngestService } from "./ingest"

function createHeartbeatEvent(eventId: string, overrides: Record<string, unknown> = {}) {
  return {
    event_id: eventId,
    adapter: "opencode",
    adapter_version: "0.1.0",
    device_uid: "device-1",
    event_type: "plugin.heartbeat",
    occurred_at: "2026-02-22T10:30:00.000Z",
    payload: {
      uptime_sec: 10,
      active_session_ids: ["session-1"],
      queue_depth: 0,
    },
    ...overrides,
  }
}

describe("createPluginEventsIngestService", () => {
  it("handles accepted, deduped, and invalid events in one batch", async () => {
    const seenEventIds = new Set<string>()
    const persisted: Array<{ userId: string; deviceId: string; eventId: string }> = []

    const ingest = createPluginEventsIngestService({
      getOrCreateDeviceId: async ({ userId, deviceUid }) => `${userId}:${deviceUid}`,
      persistEvent: async ({ userId, deviceId, event }) => {
        if (seenEventIds.has(event.event_id)) {
          return "deduped"
        }

        seenEventIds.add(event.event_id)
        persisted.push({
          userId,
          deviceId,
          eventId: event.event_id,
        })
        return "accepted"
      },
    })

    const acceptedEvent = createHeartbeatEvent("11111111-1111-4111-8111-111111111111")
    const duplicateEvent = createHeartbeatEvent("11111111-1111-4111-8111-111111111111")
    const invalidEvent = createHeartbeatEvent("22222222-2222-4222-8222-222222222222", {
      payload: {
        uptime_sec: -1,
        active_session_ids: ["session-1"],
        queue_depth: 0,
      },
    })

    const result = await ingest({
      userId: "user-1",
      payload: {
        events: [acceptedEvent, duplicateEvent, invalidEvent],
      },
    })

    expect(result).toEqual({
      accepted: 1,
      deduped: 1,
      errors: [
        {
          event_id: "22222222-2222-4222-8222-222222222222",
          code: "INVALID_PAYLOAD",
          message: "Invalid payload",
        },
      ],
    })

    expect(persisted).toEqual([
      {
        userId: "user-1",
        deviceId: "user-1:device-1",
        eventId: "11111111-1111-4111-8111-111111111111",
      },
    ])
  })

  it("fails when an invalid event is missing a valid event_id", async () => {
    const ingest = createPluginEventsIngestService({
      getOrCreateDeviceId: async () => "device-1",
      persistEvent: async () => "accepted",
    })

    await expect(
      ingest({
        userId: "user-1",
        payload: {
          events: [
            {
              adapter: "opencode",
              adapter_version: "0.1.0",
              device_uid: "device-1",
              event_type: "plugin.heartbeat",
              occurred_at: "2026-02-22T10:30:00.000Z",
              payload: {
                uptime_sec: -1,
                active_session_ids: ["session-1"],
                queue_depth: 0,
              },
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(ApiHttpError)
  })
})
