import { describe, expect, it, vi } from "vitest"

import { createAttentionRequestReducer } from "./reducer"
import type { AttentionRequestStore } from "./reducer"

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

function makeStore(overrides: Partial<AttentionRequestStore> = {}): AttentionRequestStore {
  return {
    upsertRequest: vi.fn().mockResolvedValue(undefined),
    closeRequest: vi.fn().mockResolvedValue(undefined),
    countOpenRequests: vi.fn().mockResolvedValue(1),
    updateSessionAttention: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe("createAttentionRequestReducer", () => {
  describe("permission.asked", () => {
    it("upserts request as open, counts open requests, and updates session attention", async () => {
      const store = makeStore({ countOpenRequests: vi.fn().mockResolvedValue(1) })
      const reducer = createAttentionRequestReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "permission.asked",
          session_id: "session-abc",
          payload: {
            id: "perm-01",
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

      expect(store.upsertRequest).toHaveBeenCalledOnce()
      expect(store.upsertRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "perm-01",
          sessionId: "session-abc",
          userId,
          deviceId,
          kind: "permission",
          openedAt: receivedAt,
        }),
      )

      expect(store.countOpenRequests).toHaveBeenCalledWith({ sessionId: "session-abc", userId })

      expect(store.updateSessionAttention).toHaveBeenCalledOnce()
      expect(store.updateSessionAttention).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-abc",
          userId,
          attentionCount: 1,
          requiresAttention: true,
          lastAttentionAt: receivedAt,
        }),
      )
    })
  })

  describe("question.asked", () => {
    it("upserts request as open with kind=question and updates session attention", async () => {
      const store = makeStore({ countOpenRequests: vi.fn().mockResolvedValue(2) })
      const reducer = createAttentionRequestReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "question.asked",
          session_id: "session-abc",
          payload: {
            id: "question-01",
            sessionID: "session-abc",
            questions: [
              {
                header: "Test Scope",
                question: "Which tests should I run?",
                options: [
                  { label: "Unit", description: "Run unit tests only" },
                  { label: "All", description: "Run all test suites" },
                ],
              },
            ],
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.upsertRequest).toHaveBeenCalledOnce()
      expect(store.upsertRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "question-01",
          sessionId: "session-abc",
          userId,
          deviceId,
          kind: "question",
          openedAt: receivedAt,
        }),
      )

      expect(store.updateSessionAttention).toHaveBeenCalledWith(
        expect.objectContaining({
          attentionCount: 2,
          requiresAttention: true,
          lastAttentionAt: receivedAt,
        }),
      )
    })
  })

  describe("permission.replied", () => {
    it("closes request as resolved when reply=once", async () => {
      const store = makeStore({ countOpenRequests: vi.fn().mockResolvedValue(0) })
      const reducer = createAttentionRequestReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "permission.replied",
          session_id: "session-abc",
          payload: {
            sessionID: "session-abc",
            requestID: "perm-01",
            reply: "once",
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.closeRequest).toHaveBeenCalledOnce()
      expect(store.closeRequest).toHaveBeenCalledWith({
        requestId: "perm-01",
        userId,
        status: "resolved",
        resolvedAt: receivedAt,
      })

      expect(store.updateSessionAttention).toHaveBeenCalledWith(
        expect.objectContaining({
          attentionCount: 0,
          requiresAttention: false,
          lastAttentionAt: null,
        }),
      )
    })

    it("closes request as resolved when reply=always", async () => {
      const store = makeStore({ countOpenRequests: vi.fn().mockResolvedValue(0) })
      const reducer = createAttentionRequestReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "permission.replied",
          session_id: "session-abc",
          payload: {
            sessionID: "session-abc",
            requestID: "perm-01",
            reply: "always",
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.closeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ status: "resolved" }),
      )
    })

    it("closes request as rejected when reply=reject", async () => {
      const store = makeStore({ countOpenRequests: vi.fn().mockResolvedValue(1) })
      const reducer = createAttentionRequestReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "permission.replied",
          session_id: "session-abc",
          payload: {
            sessionID: "session-abc",
            requestID: "perm-01",
            reply: "reject",
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.closeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ status: "rejected" }),
      )

      // Remaining open requests keep attention active
      expect(store.updateSessionAttention).toHaveBeenCalledWith(
        expect.objectContaining({
          attentionCount: 1,
          requiresAttention: true,
          lastAttentionAt: receivedAt,
        }),
      )
    })
  })

  describe("question.replied", () => {
    it("closes request as resolved and clears attention when no open requests remain", async () => {
      const store = makeStore({ countOpenRequests: vi.fn().mockResolvedValue(0) })
      const reducer = createAttentionRequestReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "question.replied",
          session_id: "session-abc",
          payload: {
            sessionID: "session-abc",
            requestID: "question-01",
            answers: [["All"]],
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.closeRequest).toHaveBeenCalledWith({
        requestId: "question-01",
        userId,
        status: "resolved",
        resolvedAt: receivedAt,
      })

      expect(store.updateSessionAttention).toHaveBeenCalledWith(
        expect.objectContaining({
          attentionCount: 0,
          requiresAttention: false,
          lastAttentionAt: null,
        }),
      )
    })
  })

  describe("question.rejected", () => {
    it("closes request as rejected and clears attention when no open requests remain", async () => {
      const store = makeStore({ countOpenRequests: vi.fn().mockResolvedValue(0) })
      const reducer = createAttentionRequestReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "question.rejected",
          session_id: "session-abc",
          payload: {
            sessionID: "session-abc",
            requestID: "question-01",
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.closeRequest).toHaveBeenCalledWith({
        requestId: "question-01",
        userId,
        status: "rejected",
        resolvedAt: receivedAt,
      })

      expect(store.updateSessionAttention).toHaveBeenCalledWith(
        expect.objectContaining({
          attentionCount: 0,
          requiresAttention: false,
          lastAttentionAt: null,
        }),
      )
    })
  })

  describe("non-attention event types", () => {
    it("does not call any store methods for session.created", async () => {
      const store = makeStore()
      const reducer = createAttentionRequestReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "session.created",
          session_id: "session-abc",
          payload: {
            info: {
              id: "session-abc",
              title: "Refactor auth",
              directory: "/Users/foo/repo",
              projectID: "proj-1",
              version: "1",
              time: { created: 1708559400000, updated: 1708559440000 },
            },
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.upsertRequest).not.toHaveBeenCalled()
      expect(store.closeRequest).not.toHaveBeenCalled()
      expect(store.countOpenRequests).not.toHaveBeenCalled()
      expect(store.updateSessionAttention).not.toHaveBeenCalled()
    })

    it("does not call any store methods for plugin.heartbeat", async () => {
      const store = makeStore()
      const reducer = createAttentionRequestReducer(store)

      await reducer({
        event: {
          ...BASE_EVENT,
          event_type: "plugin.heartbeat",
          payload: {
            uptime_sec: 120,
            active_session_ids: ["session-1"],
            queue_depth: 0,
          },
        },
        userId,
        deviceId,
        receivedAt,
      })

      expect(store.upsertRequest).not.toHaveBeenCalled()
      expect(store.closeRequest).not.toHaveBeenCalled()
      expect(store.countOpenRequests).not.toHaveBeenCalled()
      expect(store.updateSessionAttention).not.toHaveBeenCalled()
    })
  })
})
