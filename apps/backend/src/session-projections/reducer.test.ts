import { describe, expect, it, vi } from "vitest"

import { createSessionProjectionReducer } from "./reducer"
import type { SessionProjectionStore } from "./reducer"

const receivedAt = new Date("2026-02-22T10:30:00.000Z")
const userId = "user-1"
const deviceId = "device-1"

const BASE_EVENT = {
  event_id: "11111111-1111-4111-8111-111111111111",
  adapter: "opencode",
  adapter_version: "1.0.0",
  device_uid: "dev-uid-1",
  occurred_at: "2026-02-22T10:30:00.000Z",
} as const

const SESSION_INFO = {
  id: "session-abc",
  title: "Refactor auth",
  directory: "/Users/foo/repo",
  projectID: "proj-1",
  version: "1",
  time: { created: 1708559400000, updated: 1708559440000 },
}

function makeStore(overrides: Partial<SessionProjectionStore> = {}): SessionProjectionStore {
  return {
    upsertSession: vi.fn().mockResolvedValue(undefined),
    updateSession: vi.fn().mockResolvedValue(undefined),
    updateSessionsHeartbeat: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe("createSessionProjectionReducer", () => {
  describe("session.created", () => {
    it("upserts session with is_open=true, correct title and directory", async () => {
      const store = makeStore()
      const reducer = createSessionProjectionReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "session.created",
          session_id: "session-abc",
          payload: { info: SESSION_INFO },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.upsertSession).toHaveBeenCalledOnce()
      expect(store.upsertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-abc",
          userId,
          deviceId,
          title: "Refactor auth",
          directory: "/Users/foo/repo",
          sessionState: "unknown",
          isOpen: true,
          lastEventAt: receivedAt,
        }),
      )
    })
  })

  describe("session.updated", () => {
    it("calls updateSession with new title, directory, and lastEventAt", async () => {
      const store = makeStore()
      const reducer = createSessionProjectionReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "session.updated",
          session_id: "session-abc",
          payload: {
            info: { ...SESSION_INFO, title: "Refactored auth complete" },
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.updateSession).toHaveBeenCalledOnce()
      expect(store.updateSession).toHaveBeenCalledWith(
        "session-abc",
        userId,
        expect.objectContaining({
          title: "Refactored auth complete",
          lastEventAt: receivedAt,
        }),
      )
    })
  })

  describe("session.deleted", () => {
    it("closes session and disables requires_attention", async () => {
      const store = makeStore()
      const reducer = createSessionProjectionReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "session.deleted",
          session_id: "session-abc",
          payload: { info: SESSION_INFO },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.updateSession).toHaveBeenCalledOnce()
      expect(store.updateSession).toHaveBeenCalledWith(
        "session-abc",
        userId,
        expect.objectContaining({
          isOpen: false,
          requiresAttention: false,
          lastEventAt: receivedAt,
        }),
      )
    })
  })

  describe("session.status", () => {
    it("sets sessionState=busy and updates lastStatusAt and lastEventAt", async () => {
      const store = makeStore()
      const reducer = createSessionProjectionReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "session.status",
          session_id: "session-abc",
          payload: {
            sessionID: "session-abc",
            status: { type: "busy" },
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.updateSession).toHaveBeenCalledOnce()
      expect(store.updateSession).toHaveBeenCalledWith(
        "session-abc",
        userId,
        expect.objectContaining({
          sessionState: "busy",
          lastStatusAt: receivedAt,
          lastEventAt: receivedAt,
        }),
      )
    })

    it("sets sessionState=retry", async () => {
      const store = makeStore()
      const reducer = createSessionProjectionReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "session.status",
          session_id: "session-abc",
          payload: {
            sessionID: "session-abc",
            status: { type: "retry", attempt: 2, message: "rate limited", next: 1708559500000 },
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.updateSession).toHaveBeenCalledWith(
        "session-abc",
        userId,
        expect.objectContaining({ sessionState: "retry" }),
      )
    })

    it("sets sessionState=idle", async () => {
      const store = makeStore()
      const reducer = createSessionProjectionReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "session.status",
          session_id: "session-abc",
          payload: {
            sessionID: "session-abc",
            status: { type: "idle" },
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.updateSession).toHaveBeenCalledWith(
        "session-abc",
        userId,
        expect.objectContaining({ sessionState: "idle" }),
      )
    })
  })

  describe("plugin.heartbeat", () => {
    it("updates lastHeartbeatAt for active session IDs", async () => {
      const store = makeStore()
      const reducer = createSessionProjectionReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "plugin.heartbeat",
          payload: {
            uptime_sec: 120,
            active_session_ids: ["session-1", "session-2"],
            queue_depth: 0,
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.updateSessionsHeartbeat).toHaveBeenCalledOnce()
      expect(store.updateSessionsHeartbeat).toHaveBeenCalledWith(
        ["session-1", "session-2"],
        userId,
        receivedAt,
      )
    })

    it("does not call updateSessionsHeartbeat when active_session_ids is empty", async () => {
      const store = makeStore()
      const reducer = createSessionProjectionReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "plugin.heartbeat",
          payload: {
            uptime_sec: 120,
            active_session_ids: [],
            queue_depth: 0,
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.updateSessionsHeartbeat).not.toHaveBeenCalled()
    })
  })

  describe("non-session event types", () => {
    it("does not call any store methods for device.activity", async () => {
      const store = makeStore()
      const reducer = createSessionProjectionReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "device.activity",
          payload: {
            is_active: true,
            idle_seconds: 0,
            frontmost_app: "Terminal",
            terminal_frontmost: true,
            sampled_at: "2026-02-22T10:30:00.000Z",
            confidence: "high",
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.upsertSession).not.toHaveBeenCalled()
      expect(store.updateSession).not.toHaveBeenCalled()
      expect(store.updateSessionsHeartbeat).not.toHaveBeenCalled()
    })

    it("does not call any store methods for permission.asked", async () => {
      const store = makeStore()
      const reducer = createSessionProjectionReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "permission.asked",
          session_id: "session-abc",
          payload: {
            id: "perm-1",
            sessionID: "session-abc",
            permission: "bash",
            patterns: ["npm install"],
            always: [],
            metadata: {},
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.upsertSession).not.toHaveBeenCalled()
      expect(store.updateSession).not.toHaveBeenCalled()
      expect(store.updateSessionsHeartbeat).not.toHaveBeenCalled()
    })
  })
})
