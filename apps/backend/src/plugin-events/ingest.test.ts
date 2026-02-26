import { describe, expect, it, vi } from "vitest"

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

function createPermissionAskedEvent(eventId: string) {
  return {
    event_id: eventId,
    adapter: "opencode",
    adapter_version: "0.1.0",
    device_uid: "device-1",
    event_type: "permission.asked",
    session_id: "session-1",
    occurred_at: "2026-02-22T10:30:00.000Z",
    payload: {
      id: "perm-1",
      sessionID: "session-1",
      permission: "bash",
      patterns: ["npm install"],
      always: [],
      metadata: {},
    },
  }
}

function createSessionCreatedEvent(eventId: string) {
  return {
    event_id: eventId,
    adapter: "opencode",
    adapter_version: "0.1.0",
    device_uid: "device-1",
    event_type: "session.created",
    session_id: "session-1",
    occurred_at: "2026-02-22T10:30:00.000Z",
    payload: {
      info: {
        id: "session-1",
        title: "Test Session",
        directory: "/home/user/project",
        projectID: "proj-1",
        version: "1",
        time: { created: 1708559400000, updated: 1708559400000 },
      },
    },
  }
}

function createBaseStore(overrides: Record<string, unknown> = {}) {
  return {
    getOrCreateDeviceId: async ({ userId, deviceUid }: { userId: string; deviceUid: string }) =>
      `${userId}:${deviceUid}`,
    persistEvent: async () => "accepted" as const,
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

describe("createPluginEventsIngestService - socket delta emission", () => {
  it("emits sessions.delta for session projection events (plugin.heartbeat)", async () => {
    const emitSessionsDelta = vi.fn().mockResolvedValue(undefined)
    const emitRequestsDelta = vi.fn().mockResolvedValue(undefined)

    const ingest = createPluginEventsIngestService({
      ...createBaseStore(),
      projectEvent: vi.fn().mockResolvedValue(undefined),
      socketEmitter: { emitSessionsDelta, emitRequestsDelta },
    })

    await ingest({
      userId: "user-1",
      payload: { events: [createHeartbeatEvent("11111111-1111-4111-8111-111111111111")] },
    })

    expect(emitSessionsDelta).toHaveBeenCalledOnce()
    expect(emitSessionsDelta).toHaveBeenCalledWith("user-1")
    expect(emitRequestsDelta).not.toHaveBeenCalled()
  })

  it("emits sessions.delta for session.created events", async () => {
    const emitSessionsDelta = vi.fn().mockResolvedValue(undefined)
    const emitRequestsDelta = vi.fn().mockResolvedValue(undefined)

    const ingest = createPluginEventsIngestService({
      ...createBaseStore(),
      projectEvent: vi.fn().mockResolvedValue(undefined),
      socketEmitter: { emitSessionsDelta, emitRequestsDelta },
    })

    await ingest({
      userId: "user-1",
      payload: { events: [createSessionCreatedEvent("11111111-1111-4111-8111-111111111111")] },
    })

    expect(emitSessionsDelta).toHaveBeenCalledOnce()
    expect(emitSessionsDelta).toHaveBeenCalledWith("user-1")
    expect(emitRequestsDelta).not.toHaveBeenCalled()
  })

  it("emits both sessions.delta and requests.delta for attention events (permission.asked)", async () => {
    const emitSessionsDelta = vi.fn().mockResolvedValue(undefined)
    const emitRequestsDelta = vi.fn().mockResolvedValue(undefined)

    const ingest = createPluginEventsIngestService({
      ...createBaseStore(),
      projectEvent: vi.fn().mockResolvedValue(undefined),
      projectAttention: vi.fn().mockResolvedValue(undefined),
      socketEmitter: { emitSessionsDelta, emitRequestsDelta },
    })

    await ingest({
      userId: "user-1",
      payload: { events: [createPermissionAskedEvent("11111111-1111-4111-8111-111111111111")] },
    })

    expect(emitSessionsDelta).toHaveBeenCalledOnce()
    expect(emitSessionsDelta).toHaveBeenCalledWith("user-1")
    expect(emitRequestsDelta).toHaveBeenCalledOnce()
    expect(emitRequestsDelta).toHaveBeenCalledWith("user-1")
  })

  it("does not emit deltas for deduped events", async () => {
    const emitSessionsDelta = vi.fn().mockResolvedValue(undefined)
    const emitRequestsDelta = vi.fn().mockResolvedValue(undefined)

    const ingest = createPluginEventsIngestService({
      ...createBaseStore({
        persistEvent: async () => "deduped" as const,
      }),
      projectEvent: vi.fn().mockResolvedValue(undefined),
      socketEmitter: { emitSessionsDelta, emitRequestsDelta },
    })

    await ingest({
      userId: "user-1",
      payload: { events: [createHeartbeatEvent("11111111-1111-4111-8111-111111111111")] },
    })

    expect(emitSessionsDelta).not.toHaveBeenCalled()
    expect(emitRequestsDelta).not.toHaveBeenCalled()
  })

  it("does not emit deltas when socketEmitter is not configured", async () => {
    // No error should be thrown when socketEmitter is absent
    const ingest = createPluginEventsIngestService({
      ...createBaseStore(),
      projectEvent: vi.fn().mockResolvedValue(undefined),
      // no socketEmitter
    })

    const result = await ingest({
      userId: "user-1",
      payload: { events: [createHeartbeatEvent("11111111-1111-4111-8111-111111111111")] },
    })

    expect(result.accepted).toBe(1)
  })

  it("does not emit sessions.delta for non-projection events (plugin.connected)", async () => {
    const emitSessionsDelta = vi.fn().mockResolvedValue(undefined)
    const emitRequestsDelta = vi.fn().mockResolvedValue(undefined)

    const ingest = createPluginEventsIngestService({
      ...createBaseStore(),
      projectEvent: vi.fn().mockResolvedValue(undefined),
      socketEmitter: { emitSessionsDelta, emitRequestsDelta },
    })

    await ingest({
      userId: "user-1",
      payload: {
        events: [
          {
            event_id: "11111111-1111-4111-8111-111111111111",
            adapter: "opencode",
            adapter_version: "0.1.0",
            device_uid: "device-1",
            event_type: "plugin.connected",
            occurred_at: "2026-02-22T10:30:00.000Z",
            payload: {
              plugin_version: "1.0.0",
              opencode_version: "0.1.0",
              platform: "darwin",
              hostname: "mbp",
              capabilities: {
                activity: true,
                unblock_permission: true,
                unblock_question: true,
              },
            },
          },
        ],
      },
    })

    expect(emitSessionsDelta).not.toHaveBeenCalled()
    expect(emitRequestsDelta).not.toHaveBeenCalled()
  })
})
