import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SessionTracker, sendHeartbeat, startHeartbeat } from "./heartbeat"

describe("sendHeartbeat", () => {
  const baseOptions = {
    backendUrl: "http://localhost:4000",
    pat: "pat_test_secret",
    deviceUid: "device-uid-abc",
    uptimeSec: 120,
    activeSessionIds: ["session_1", "session_2"],
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("POSTs a plugin.heartbeat event to the backend", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    await sendHeartbeat(baseOptions)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]

    expect(url).toBe("http://localhost:4000/v1/plugin/events")
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer pat_test_secret",
    })

    const body = JSON.parse(init.body as string) as { events: unknown[] }
    expect(body.events).toHaveLength(1)

    const event = body.events[0] as Record<string, unknown>
    expect(event.event_type).toBe("plugin.heartbeat")
    expect(event.device_uid).toBe("device-uid-abc")
    expect(event.adapter).toBe("opencode")

    const payload = event.payload as Record<string, unknown>
    expect(payload.uptime_sec).toBe(120)
    expect(payload.active_session_ids).toEqual(["session_1", "session_2"])
    expect(payload.queue_depth).toBe(0)
  })

  it("includes custom queue_depth if provided", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    await sendHeartbeat({ ...baseOptions, queueDepth: 5 })

    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { events: { payload: { queue_depth: number } }[] }
    expect(body.events[0].payload.queue_depth).toBe(5)
  })

  it("strips trailing slash from backendUrl", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    await sendHeartbeat({ ...baseOptions, backendUrl: "http://localhost:4000/" })

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain("//v1")
    expect(url).toContain("/v1/plugin/events")
  })

  it("throws if the backend returns a non-OK response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }))
    vi.stubGlobal("fetch", mockFetch)

    await expect(sendHeartbeat(baseOptions)).rejects.toThrow("401")
  })
})

describe("startHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("sends a heartbeat after intervalMs", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    const getActiveSessionIds = vi.fn().mockReturnValue(["session_1"])
    const handle = startHeartbeat({
      backendUrl: "http://localhost:4000",
      pat: "pat_test",
      deviceUid: "dev-uid",
      getActiveSessionIds,
      intervalMs: 1000,
    })

    // No heartbeat before the interval fires
    expect(mockFetch).not.toHaveBeenCalled()

    // Advance timer and flush promises
    await vi.advanceTimersByTimeAsync(1000)

    expect(mockFetch).toHaveBeenCalledOnce()
    const body = JSON.parse(
      (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { events: { payload: { active_session_ids: string[] } }[] }
    expect(body.events[0].payload.active_session_ids).toEqual(["session_1"])

    handle.stop()
  })

  it("sends multiple heartbeats at each interval", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    const handle = startHeartbeat({
      backendUrl: "http://localhost:4000",
      pat: "pat_test",
      deviceUid: "dev-uid",
      getActiveSessionIds: () => [],
      intervalMs: 500,
    })

    await vi.advanceTimersByTimeAsync(1500)

    // Should have fired 3 times (500ms, 1000ms, 1500ms)
    expect(mockFetch).toHaveBeenCalledTimes(3)

    handle.stop()
  })

  it("stops sending after handle.stop() is called", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ accepted: 1 }), { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    const handle = startHeartbeat({
      backendUrl: "http://localhost:4000",
      pat: "pat_test",
      deviceUid: "dev-uid",
      getActiveSessionIds: () => [],
      intervalMs: 500,
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(mockFetch).toHaveBeenCalledOnce()

    handle.stop()

    await vi.advanceTimersByTimeAsync(1000)
    // Should still only have one call
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it("logs errors but continues running if a heartbeat fails", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"))
    vi.stubGlobal("fetch", mockFetch)

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const handle = startHeartbeat({
      backendUrl: "http://localhost:4000",
      pat: "pat_test",
      deviceUid: "dev-uid",
      getActiveSessionIds: () => [],
      intervalMs: 500,
    })

    await vi.advanceTimersByTimeAsync(1000)

    // Two heartbeats attempted, both failed, but timer kept running
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalled()

    handle.stop()
    consoleError.mockRestore()
  })
})

describe("SessionTracker", () => {
  it("starts with no active sessions", () => {
    const tracker = new SessionTracker()
    expect(tracker.getActiveSessionIds()).toEqual([])
  })

  it("tracks added sessions", () => {
    const tracker = new SessionTracker()
    tracker.addSession("session_1")
    tracker.addSession("session_2")
    expect(tracker.getActiveSessionIds()).toContain("session_1")
    expect(tracker.getActiveSessionIds()).toContain("session_2")
    expect(tracker.getActiveSessionIds()).toHaveLength(2)
  })

  it("removes sessions on removeSession", () => {
    const tracker = new SessionTracker()
    tracker.addSession("session_1")
    tracker.addSession("session_2")
    tracker.removeSession("session_1")
    expect(tracker.getActiveSessionIds()).not.toContain("session_1")
    expect(tracker.getActiveSessionIds()).toContain("session_2")
  })

  it("is idempotent on duplicate addSession calls", () => {
    const tracker = new SessionTracker()
    tracker.addSession("session_1")
    tracker.addSession("session_1")
    expect(tracker.getActiveSessionIds()).toHaveLength(1)
  })

  it("handles removeSession for unknown session gracefully", () => {
    const tracker = new SessionTracker()
    expect(() => tracker.removeSession("unknown")).not.toThrow()
  })
})
