import { describe, expect, it } from "vitest"

import { createSessionsOpenService } from "./service"
import type { OpenSessionRow } from "./service"

function makeRow(overrides: Partial<OpenSessionRow> & { sessionId: string }): OpenSessionRow {
  return {
    sessionId: overrides.sessionId,
    title: "title" in overrides ? (overrides.title ?? null) : "Test Session",
    sessionState: overrides.sessionState ?? "idle",
    requiresAttention: overrides.requiresAttention ?? false,
    attentionCount: overrides.attentionCount ?? 0,
    lastEventAt: overrides.lastEventAt ?? new Date("2026-02-22T10:00:00.000Z"),
    lastAttentionAt: overrides.lastAttentionAt ?? null,
    isStale: overrides.isStale ?? false,
    deviceId: overrides.deviceId ?? "device-1",
    deviceName: overrides.deviceName ?? "MacBook Pro",
    devicePlatform: overrides.devicePlatform ?? "darwin",
    deviceLastSeenAt: overrides.deviceLastSeenAt ?? new Date("2026-02-22T10:00:00.000Z"),
    activityIsActive: overrides.activityIsActive ?? null,
    activityIdleSeconds: overrides.activityIdleSeconds ?? null,
    activitySampledAt: overrides.activitySampledAt ?? null,
  }
}

describe("createSessionsOpenService", () => {
  it("returns empty groups when no sessions", async () => {
    const service = createSessionsOpenService({
      getOpenSessions: async () => [],
    })

    const result = await service({ userId: "user-1" })
    expect(result).toEqual({ groups: [] })
  })

  it("groups sessions by device", async () => {
    const service = createSessionsOpenService({
      getOpenSessions: async () => [
        makeRow({ sessionId: "s1", deviceId: "device-1" }),
        makeRow({ sessionId: "s2", deviceId: "device-2", deviceName: "iMac" }),
      ],
    })

    const result = await service({ userId: "user-1" })
    expect(result.groups).toHaveLength(2)
    expect(result.groups[0].sessions).toHaveLength(1)
    expect(result.groups[1].sessions).toHaveLength(1)
  })

  it("puts multiple sessions from same device in same group", async () => {
    const service = createSessionsOpenService({
      getOpenSessions: async () => [
        makeRow({ sessionId: "s1", deviceId: "device-1" }),
        makeRow({ sessionId: "s2", deviceId: "device-1" }),
        makeRow({ sessionId: "s3", deviceId: "device-1" }),
      ],
    })

    const result = await service({ userId: "user-1" })
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].sessions).toHaveLength(3)
  })

  it("sorts sessions within group: requires_attention first", async () => {
    const service = createSessionsOpenService({
      getOpenSessions: async () => [
        makeRow({
          sessionId: "s1",
          deviceId: "device-1",
          requiresAttention: false,
          lastEventAt: new Date("2026-02-22T10:05:00.000Z"),
        }),
        makeRow({
          sessionId: "s2",
          deviceId: "device-1",
          requiresAttention: true,
          attentionCount: 1,
          lastAttentionAt: new Date("2026-02-22T10:04:00.000Z"),
          lastEventAt: new Date("2026-02-22T10:04:00.000Z"),
        }),
      ],
    })

    const result = await service({ userId: "user-1" })
    const sessions = result.groups[0].sessions
    expect(sessions[0].session_id).toBe("s2")
    expect(sessions[1].session_id).toBe("s1")
  })

  it("sorts sessions within group: last_attention_at desc when both require attention", async () => {
    const service = createSessionsOpenService({
      getOpenSessions: async () => [
        makeRow({
          sessionId: "s1",
          deviceId: "device-1",
          requiresAttention: true,
          attentionCount: 1,
          lastAttentionAt: new Date("2026-02-22T10:01:00.000Z"),
          lastEventAt: new Date("2026-02-22T10:05:00.000Z"),
        }),
        makeRow({
          sessionId: "s2",
          deviceId: "device-1",
          requiresAttention: true,
          attentionCount: 1,
          lastAttentionAt: new Date("2026-02-22T10:03:00.000Z"),
          lastEventAt: new Date("2026-02-22T10:03:00.000Z"),
        }),
      ],
    })

    const result = await service({ userId: "user-1" })
    const sessions = result.groups[0].sessions
    expect(sessions[0].session_id).toBe("s2") // more recent attention
    expect(sessions[1].session_id).toBe("s1")
  })

  it("sorts sessions within group: last_event_at desc when no attention", async () => {
    const service = createSessionsOpenService({
      getOpenSessions: async () => [
        makeRow({
          sessionId: "s1",
          deviceId: "device-1",
          lastEventAt: new Date("2026-02-22T10:01:00.000Z"),
        }),
        makeRow({
          sessionId: "s2",
          deviceId: "device-1",
          lastEventAt: new Date("2026-02-22T10:05:00.000Z"),
        }),
      ],
    })

    const result = await service({ userId: "user-1" })
    const sessions = result.groups[0].sessions
    expect(sessions[0].session_id).toBe("s2") // more recent event
    expect(sessions[1].session_id).toBe("s1")
  })

  it("sorts device groups by top session attention-first ordering", async () => {
    const service = createSessionsOpenService({
      getOpenSessions: async () => [
        // device-1 has no attention
        makeRow({
          sessionId: "s1",
          deviceId: "device-1",
          requiresAttention: false,
          lastEventAt: new Date("2026-02-22T10:05:00.000Z"),
        }),
        // device-2 has attention
        makeRow({
          sessionId: "s2",
          deviceId: "device-2",
          deviceName: "iMac",
          requiresAttention: true,
          attentionCount: 1,
          lastAttentionAt: new Date("2026-02-22T10:04:00.000Z"),
          lastEventAt: new Date("2026-02-22T10:04:00.000Z"),
        }),
      ],
    })

    const result = await service({ userId: "user-1" })
    expect(result.groups[0].device.name).toBe("iMac") // device-2 bubbles to top
    expect(result.groups[1].device.name).toBe("MacBook Pro")
  })

  it("includes device activity when available", async () => {
    const sampledAt = new Date("2026-02-22T10:00:00.000Z")
    const service = createSessionsOpenService({
      getOpenSessions: async () => [
        makeRow({
          sessionId: "s1",
          activityIsActive: true,
          activityIdleSeconds: 30,
          activitySampledAt: sampledAt,
        }),
      ],
    })

    const result = await service({ userId: "user-1" })
    const activity = result.groups[0].device.activity
    expect(activity).not.toBeNull()
    expect(activity?.is_active).toBe(true)
    expect(activity?.idle_seconds).toBe(30)
    expect(activity?.sampled_at).toBe(sampledAt.toISOString())
  })

  it("returns null activity when not sampled", async () => {
    const service = createSessionsOpenService({
      getOpenSessions: async () => [makeRow({ sessionId: "s1", activitySampledAt: null })],
    })

    const result = await service({ userId: "user-1" })
    expect(result.groups[0].device.activity).toBeNull()
  })

  it("maps session fields to response format correctly", async () => {
    const lastEventAt = new Date("2026-02-22T10:00:00.000Z")
    const lastAttentionAt = new Date("2026-02-22T09:55:00.000Z")
    const service = createSessionsOpenService({
      getOpenSessions: async () => [
        makeRow({
          sessionId: "session-abc",
          title: "Refactor auth",
          sessionState: "busy",
          requiresAttention: true,
          attentionCount: 2,
          lastEventAt,
          lastAttentionAt,
          isStale: false,
        }),
      ],
    })

    const result = await service({ userId: "user-1" })
    const session = result.groups[0].sessions[0]
    expect(session.session_id).toBe("session-abc")
    expect(session.title).toBe("Refactor auth")
    expect(session.state).toBe("busy")
    expect(session.requires_attention).toBe(true)
    expect(session.attention_count).toBe(2)
    expect(session.last_event_at).toBe(lastEventAt.toISOString())
    expect(session.last_attention_at).toBe(lastAttentionAt.toISOString())
    expect(session.is_stale).toBe(false)
  })

  it("falls back to session_id for null title", async () => {
    const service = createSessionsOpenService({
      getOpenSessions: async () => [makeRow({ sessionId: "my-session-id", title: null })],
    })

    const result = await service({ userId: "user-1" })
    expect(result.groups[0].sessions[0].title).toBe("my-session-id")
  })

  it("passes userId to store", async () => {
    let capturedUserId = ""
    const service = createSessionsOpenService({
      getOpenSessions: async ({ userId }) => {
        capturedUserId = userId
        return []
      },
    })

    await service({ userId: "user-xyz" })
    expect(capturedUserId).toBe("user-xyz")
  })
})
