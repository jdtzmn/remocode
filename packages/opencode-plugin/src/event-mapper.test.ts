import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Event } from "@opencode-ai/sdk"

import {
  createEventBatchSender,
  createEventForwarder,
  isBlockerCanonicalEventType,
  mapOpenCodeEvent,
} from "./event-mapper"

// ────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────

const DEVICE_UID = "device-uid-abc"
const OCCURRED_AT = "2026-02-26T00:00:00.000Z"
const BACKEND_URL = "https://api.example.com"
const PAT = "pat_test_abc"

const sessionInfo = {
  id: "sess_1",
  projectID: "proj_1",
  title: "Test Session",
  directory: "/tmp",
  version: "1",
  time: { created: 1000, updated: 2000 },
}

// ────────────────────────────────────────────────────────────
// mapOpenCodeEvent
// ────────────────────────────────────────────────────────────

describe("mapOpenCodeEvent", () => {
  it("returns null for untracked event types", () => {
    const event = { type: "file.edited", properties: { file: "/foo.ts" } } as unknown as Event
    expect(mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)).toBeNull()
  })

  it("returns null for session.idle (not tracked)", () => {
    const event = { type: "session.idle", properties: { sessionID: "s1" } } as unknown as Event
    expect(mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)).toBeNull()
  })

  it("maps session.created with info payload", () => {
    const event = { type: "session.created", properties: { info: sessionInfo } } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")

    expect(result.event_type).toBe("session.created")
    expect(result.session_id).toBe("sess_1")
    expect(result.payload).toEqual({ info: sessionInfo })
    expect(result.device_uid).toBe(DEVICE_UID)
    expect(result.occurred_at).toBe(OCCURRED_AT)
    expect(result.adapter).toBe("opencode")
    expect(result.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it("maps session.updated with info payload", () => {
    const info = { ...sessionInfo, id: "sess_2", title: "Updated", version: "2" }
    const event = { type: "session.updated", properties: { info } } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    expect(result.event_type).toBe("session.updated")
    expect(result.session_id).toBe("sess_2")
    expect(result.payload).toEqual({ info })
  })

  it("maps session.deleted with info payload", () => {
    const info = { ...sessionInfo, id: "sess_3" }
    const event = { type: "session.deleted", properties: { info } } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    expect(result.event_type).toBe("session.deleted")
    expect(result.session_id).toBe("sess_3")
  })

  it("maps session.status with sessionID and status", () => {
    const event = {
      type: "session.status",
      properties: { sessionID: "sess_4", status: { type: "busy" } },
    } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    expect(result.event_type).toBe("session.status")
    expect(result.session_id).toBe("sess_4")
    expect(result.payload).toEqual({ sessionID: "sess_4", status: { type: "busy" } })
  })

  it("maps session.status retry variant", () => {
    const event = {
      type: "session.status",
      properties: {
        sessionID: "sess_5",
        status: { type: "retry", attempt: 2, message: "rate limited", next: 9999 },
      },
    } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    expect(result.event_type).toBe("session.status")
    expect(result.payload).toMatchObject({
      status: { type: "retry", attempt: 2, message: "rate limited", next: 9999 },
    })
  })

  it("maps permission.updated to canonical permission.asked", () => {
    const event = {
      type: "permission.updated",
      properties: {
        id: "perm_01",
        type: "bash",
        sessionID: "sess_6",
        messageID: "msg_1",
        callID: "call_1",
        pattern: ["npm install"],
        metadata: { cwd: "/repo" },
        time: { created: 1000 },
        title: "Run bash command",
      },
    } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    expect(result.event_type).toBe("permission.asked")
    expect(result.session_id).toBe("sess_6")
    expect(result.payload).toMatchObject({
      id: "perm_01",
      sessionID: "sess_6",
      permission: "bash",
      patterns: ["npm install"],
      metadata: { cwd: "/repo" },
      always: [],
      tool: { messageID: "msg_1", callID: "call_1" },
    })
  })

  it("maps permission.updated with array pattern", () => {
    const event = {
      type: "permission.updated",
      properties: {
        id: "perm_02",
        type: "bash",
        sessionID: "sess_7",
        messageID: "msg_2",
        callID: "call_2",
        pattern: ["npm install", "npm test"],
        metadata: {},
        time: { created: 1000 },
        title: "Run bash",
      },
    } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    expect(result.payload).toMatchObject({ patterns: ["npm install", "npm test"] })
  })

  it("maps permission.updated without pattern to empty patterns array", () => {
    const event = {
      type: "permission.updated",
      properties: {
        id: "perm_03",
        type: "bash",
        sessionID: "sess_8",
        messageID: "msg_3",
        callID: "call_3",
        pattern: undefined,
        metadata: {},
        time: { created: 1000 },
        title: "Run bash",
      },
    } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    expect(result.payload).toMatchObject({ patterns: [] })
  })

  it("maps permission.updated without messageID — omits tool", () => {
    const event = {
      type: "permission.updated",
      properties: {
        id: "perm_04",
        type: "bash",
        sessionID: "sess_9",
        messageID: undefined,
        callID: undefined,
        pattern: [],
        metadata: {},
        time: { created: 1000 },
        title: "Run bash",
      },
    } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    const payload = result.payload as Record<string, unknown>
    expect(payload.tool).toBeUndefined()
  })

  it("maps permission.replied renaming permissionID→requestID and response→reply", () => {
    const event = {
      type: "permission.replied",
      properties: { sessionID: "sess_10", permissionID: "perm_01", response: "once" },
    } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    expect(result.event_type).toBe("permission.replied")
    expect(result.session_id).toBe("sess_10")
    expect(result.payload).toEqual({ sessionID: "sess_10", requestID: "perm_01", reply: "once" })
  })

  it("maps permission.replied with always reply", () => {
    const event = {
      type: "permission.replied",
      properties: { sessionID: "sess_11", permissionID: "perm_02", response: "always" },
    } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    const payload = result.payload as Record<string, unknown>
    expect(payload.reply).toBe("always")
  })

  it("maps permission.replied with reject reply", () => {
    const event = {
      type: "permission.replied",
      properties: { sessionID: "sess_12", permissionID: "perm_03", response: "reject" },
    } as unknown as Event
    const result = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(result).not.toBeNull()
    if (!result) throw new Error("result is null")
    const payload = result.payload as Record<string, unknown>
    expect(payload.reply).toBe("reject")
  })

  it("generates unique event_ids for each call", () => {
    const event = {
      type: "session.status",
      properties: { sessionID: "s1", status: { type: "idle" } },
    } as unknown as Event
    const r1 = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)
    const r2 = mapOpenCodeEvent(event, DEVICE_UID, OCCURRED_AT)

    expect(r1).not.toBeNull()
    expect(r2).not.toBeNull()
    if (!r1 || !r2) throw new Error("result is null")
    expect(r1.event_id).not.toBe(r2.event_id)
  })
})

// ────────────────────────────────────────────────────────────
// isBlockerCanonicalEventType
// ────────────────────────────────────────────────────────────

describe("isBlockerCanonicalEventType", () => {
  it("returns true for permission.asked", () => {
    expect(isBlockerCanonicalEventType("permission.asked")).toBe(true)
  })

  it("returns true for question.asked", () => {
    expect(isBlockerCanonicalEventType("question.asked")).toBe(true)
  })

  it("returns false for session.created", () => {
    expect(isBlockerCanonicalEventType("session.created")).toBe(false)
  })

  it("returns false for permission.replied", () => {
    expect(isBlockerCanonicalEventType("permission.replied")).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// createEventBatchSender
// ────────────────────────────────────────────────────────────

describe("createEventBatchSender", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function mockFetchOk() {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ accepted: 1, deduped: 0, errors: [] }), { status: 200 }),
        ),
    )
  }

  function makeEnvelope(eventType: string, id = "evt_1") {
    return {
      event_id: id,
      adapter: "opencode",
      adapter_version: "1.0.0",
      device_uid: DEVICE_UID,
      event_type: eventType,
      session_id: "sess_1",
      occurred_at: OCCURRED_AT,
      payload: {},
    } satisfies import("./event-mapper").CanonicalEventEnvelope
  }

  it("sends events to POST /v1/plugin/events", async () => {
    mockFetchOk()
    const sender = createEventBatchSender({ backendUrl: BACKEND_URL, pat: PAT })
    sender.enqueue(makeEnvelope("session.created"))
    await sender.flush()

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BACKEND_URL}/v1/plugin/events`)
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${PAT}`)
    const body = JSON.parse(init.body as string) as { events: unknown[] }
    expect(body.events).toHaveLength(1)
    const evt = body.events[0] as Record<string, unknown>
    expect(evt.event_type).toBe("session.created")

    await sender.stop()
  })

  it("strips trailing slash from backendUrl", async () => {
    mockFetchOk()
    const sender = createEventBatchSender({ backendUrl: `${BACKEND_URL}/`, pat: PAT })
    sender.enqueue(makeEnvelope("session.updated"))
    await sender.flush()

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BACKEND_URL}/v1/plugin/events`)

    await sender.stop()
  })

  it("flushes immediately on blocker event (permission.asked)", async () => {
    mockFetchOk()
    const sender = createEventBatchSender({ backendUrl: BACKEND_URL, pat: PAT })
    sender.enqueue(makeEnvelope("permission.asked"))

    // The enqueue triggers an async flush — wait for it by explicitly flushing
    await sender.flush()

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(mockFetch).toHaveBeenCalledOnce()

    await sender.stop()
  })

  it("flushes when batch size reaches maxBatchSize", async () => {
    mockFetchOk()
    const sender = createEventBatchSender({ backendUrl: BACKEND_URL, pat: PAT, maxBatchSize: 3 })

    sender.enqueue(makeEnvelope("session.created", "e1"))
    sender.enqueue(makeEnvelope("session.updated", "e2"))
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(mockFetch).not.toHaveBeenCalled()

    // Third enqueue should trigger immediate flush
    sender.enqueue(makeEnvelope("session.deleted", "e3"))

    // Wait for the triggered flush to resolve
    await sender.flush()

    expect(mockFetch).toHaveBeenCalledOnce()
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { events: unknown[] }
    expect(body.events).toHaveLength(3)

    await sender.stop()
  })

  it("flushes on 250ms timer interval", async () => {
    mockFetchOk()
    const sender = createEventBatchSender({
      backendUrl: BACKEND_URL,
      pat: PAT,
      flushIntervalMs: 250,
    })
    sender.enqueue(makeEnvelope("session.status"))

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    // Timer not fired yet
    expect(mockFetch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(250)

    expect(mockFetch).toHaveBeenCalledOnce()

    await sender.stop()
  })

  it("does not flush if no events pending on timer", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const sender = createEventBatchSender({ backendUrl: BACKEND_URL, pat: PAT })

    await vi.advanceTimersByTimeAsync(250)

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(mockFetch).not.toHaveBeenCalled()

    await sender.stop()
  })

  it("logs error on failed batch send but does not throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("server error", { status: 500 })))
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const sender = createEventBatchSender({ backendUrl: BACKEND_URL, pat: PAT })
    sender.enqueue(makeEnvelope("session.created"))
    await sender.flush()

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[remocode]"),
      expect.any(Error),
    )

    await sender.stop()
  })

  it("stop() flushes remaining events", async () => {
    mockFetchOk()
    const sender = createEventBatchSender({ backendUrl: BACKEND_URL, pat: PAT })
    sender.enqueue(makeEnvelope("session.created", "e1"))
    sender.enqueue(makeEnvelope("session.updated", "e2"))

    await sender.stop()

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(mockFetch).toHaveBeenCalledOnce()
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { events: unknown[] }
    expect(body.events).toHaveLength(2)
  })

  it("batches multiple events together", async () => {
    mockFetchOk()
    const sender = createEventBatchSender({ backendUrl: BACKEND_URL, pat: PAT })
    sender.enqueue(makeEnvelope("session.created", "e1"))
    sender.enqueue(makeEnvelope("session.updated", "e2"))
    sender.enqueue(makeEnvelope("session.deleted", "e3"))

    await sender.flush()

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(mockFetch).toHaveBeenCalledOnce()
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { events: unknown[] }
    expect(body.events).toHaveLength(3)
  })

  it("does not send empty batch on flush", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const sender = createEventBatchSender({ backendUrl: BACKEND_URL, pat: PAT })
    await sender.flush()

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(mockFetch).not.toHaveBeenCalled()

    await sender.stop()
  })
})

// ────────────────────────────────────────────────────────────
// createEventForwarder
// ────────────────────────────────────────────────────────────

describe("createEventForwarder", () => {
  it("enqueues canonical event for tracked type", async () => {
    const enqueue = vi.fn()
    const sender = { enqueue, flush: vi.fn(), stop: vi.fn() }

    const handler = createEventForwarder({
      backendUrl: BACKEND_URL,
      pat: PAT,
      deviceUid: DEVICE_UID,
      sender,
    })

    const event = { type: "session.created", properties: { info: sessionInfo } } as unknown as Event
    await handler({ event })

    expect(enqueue).toHaveBeenCalledOnce()
    const envelope = enqueue.mock.calls[0][0] as Record<string, unknown>
    expect(envelope.event_type).toBe("session.created")
    expect(envelope.session_id).toBe("sess_1")
  })

  it("does not enqueue for untracked event types", async () => {
    const enqueue = vi.fn()
    const sender = { enqueue, flush: vi.fn(), stop: vi.fn() }

    const handler = createEventForwarder({
      backendUrl: BACKEND_URL,
      pat: PAT,
      deviceUid: DEVICE_UID,
      sender,
    })

    await handler({
      event: { type: "file.edited", properties: { file: "/foo" } } as unknown as Event,
    })

    expect(enqueue).not.toHaveBeenCalled()
  })

  it("enqueues permission.asked for permission.updated events", async () => {
    const enqueue = vi.fn()
    const sender = { enqueue, flush: vi.fn(), stop: vi.fn() }

    const handler = createEventForwarder({
      backendUrl: BACKEND_URL,
      pat: PAT,
      deviceUid: DEVICE_UID,
      sender,
    })

    const event = {
      type: "permission.updated",
      properties: {
        id: "p1",
        type: "bash",
        sessionID: "s1",
        messageID: "m1",
        callID: "c1",
        pattern: ["cmd"],
        metadata: {},
        time: { created: 1 },
        title: "bash",
      },
    } as unknown as Event
    await handler({ event })

    expect(enqueue).toHaveBeenCalledOnce()
    const envelope = enqueue.mock.calls[0][0] as Record<string, unknown>
    expect(envelope.event_type).toBe("permission.asked")
  })
})
