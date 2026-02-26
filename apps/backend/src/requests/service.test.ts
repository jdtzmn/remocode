import { describe, expect, it } from "vitest"

import { createRequestsOpenService } from "./service"
import type { OpenRequestRow } from "./service"

function makeRow(overrides: Partial<OpenRequestRow> & { requestId: string }): OpenRequestRow {
  return {
    requestId: overrides.requestId,
    sessionId: overrides.sessionId ?? "session-1",
    deviceId: overrides.deviceId ?? "device-1",
    kind: overrides.kind ?? "permission",
    status: overrides.status ?? "open",
    openedAt: overrides.openedAt ?? new Date("2026-02-22T10:00:00.000Z"),
    payload: overrides.payload ?? { id: overrides.requestId, sessionID: "session-1" },
  }
}

describe("createRequestsOpenService", () => {
  it("returns empty requests when no open requests exist", async () => {
    const service = createRequestsOpenService({
      getOpenRequests: async () => [],
    })

    const result = await service({ userId: "user-1" })
    expect(result).toEqual({ requests: [] })
  })

  it("maps a single open request to response format", async () => {
    const openedAt = new Date("2026-02-22T10:00:00.000Z")
    const payload = { id: "req-1", sessionID: "session-1", permission: "bash", patterns: [] }

    const service = createRequestsOpenService({
      getOpenRequests: async () => [
        makeRow({
          requestId: "req-1",
          sessionId: "session-abc",
          deviceId: "device-xyz",
          kind: "permission",
          status: "open",
          openedAt,
          payload,
        }),
      ],
    })

    const result = await service({ userId: "user-1" })
    expect(result.requests).toHaveLength(1)

    const req = result.requests[0]
    expect(req.request_id).toBe("req-1")
    expect(req.session_id).toBe("session-abc")
    expect(req.device_id).toBe("device-xyz")
    expect(req.kind).toBe("permission")
    expect(req.status).toBe("open")
    expect(req.opened_at).toBe(openedAt.toISOString())
    expect(req.payload).toEqual(payload)
  })

  it("maps a question request correctly", async () => {
    const service = createRequestsOpenService({
      getOpenRequests: async () => [
        makeRow({
          requestId: "q-1",
          kind: "question",
          status: "open",
          payload: {
            id: "q-1",
            sessionID: "session-1",
            questions: [{ header: "Test", question: "Which tests?", options: [] }],
          },
        }),
      ],
    })

    const result = await service({ userId: "user-1" })
    expect(result.requests[0].kind).toBe("question")
  })

  it("returns all open requests across multiple sessions", async () => {
    const service = createRequestsOpenService({
      getOpenRequests: async () => [
        makeRow({ requestId: "req-1", sessionId: "session-1" }),
        makeRow({ requestId: "req-2", sessionId: "session-2" }),
        makeRow({ requestId: "req-3", sessionId: "session-1" }),
      ],
    })

    const result = await service({ userId: "user-1" })
    expect(result.requests).toHaveLength(3)
  })

  it("preserves order from store (most recently opened first)", async () => {
    const service = createRequestsOpenService({
      getOpenRequests: async () => [
        makeRow({ requestId: "req-later", openedAt: new Date("2026-02-22T10:05:00.000Z") }),
        makeRow({ requestId: "req-earlier", openedAt: new Date("2026-02-22T10:00:00.000Z") }),
      ],
    })

    const result = await service({ userId: "user-1" })
    expect(result.requests[0].request_id).toBe("req-later")
    expect(result.requests[1].request_id).toBe("req-earlier")
  })

  it("passes userId to store", async () => {
    let capturedUserId = ""
    const service = createRequestsOpenService({
      getOpenRequests: async ({ userId }) => {
        capturedUserId = userId
        return []
      },
    })

    await service({ userId: "user-xyz" })
    expect(capturedUserId).toBe("user-xyz")
  })

  it("includes payload from store in response", async () => {
    const customPayload = { id: "req-1", sessionID: "session-1", custom_field: "value" }
    const service = createRequestsOpenService({
      getOpenRequests: async () => [makeRow({ requestId: "req-1", payload: customPayload })],
    })

    const result = await service({ userId: "user-1" })
    expect(result.requests[0].payload).toEqual(customPayload)
  })

  it("handles multiple requests with same session_id", async () => {
    const service = createRequestsOpenService({
      getOpenRequests: async () => [
        makeRow({ requestId: "req-1", sessionId: "session-same" }),
        makeRow({ requestId: "req-2", sessionId: "session-same" }),
      ],
    })

    const result = await service({ userId: "user-1" })
    expect(result.requests).toHaveLength(2)
    expect(result.requests.every((r) => r.session_id === "session-same")).toBe(true)
  })

  it("maps opened_at date to ISO string", async () => {
    const openedAt = new Date("2026-02-22T15:30:45.123Z")
    const service = createRequestsOpenService({
      getOpenRequests: async () => [makeRow({ requestId: "req-1", openedAt })],
    })

    const result = await service({ userId: "user-1" })
    expect(result.requests[0].opened_at).toBe("2026-02-22T15:30:45.123Z")
  })
})
