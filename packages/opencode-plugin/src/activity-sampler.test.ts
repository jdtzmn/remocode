import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ActivityProvider } from "./activity-provider"
import { sendActivitySample, startActivitySampler } from "./activity-sampler"

function makeMockProvider(overrides?: Partial<ActivityProvider>): ActivityProvider {
  return {
    getIdleSeconds: vi.fn().mockResolvedValue(30),
    isUserActive: vi.fn().mockResolvedValue(true),
    getFrontmostApp: vi.fn().mockResolvedValue("iTerm2"),
    getTerminalFrontmost: vi.fn().mockResolvedValue(true),
    ...overrides,
  }
}

const baseOptions = {
  backendUrl: "http://localhost:4000",
  pat: "pat_test_secret",
  deviceUid: "device-uid-abc",
}

describe("sendActivitySample", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("POSTs a device.activity event to /v1/plugin/activity", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    const provider = makeMockProvider()
    await sendActivitySample({ ...baseOptions, provider })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]

    expect(url).toBe("http://localhost:4000/v1/plugin/activity")
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer pat_test_secret",
    })

    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.event_type).toBe("device.activity")
    expect(body.device_uid).toBe("device-uid-abc")
    expect(body.adapter).toBe("opencode")
  })

  it("returns the sampled payload with correct fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))

    const provider = makeMockProvider({
      getIdleSeconds: vi.fn().mockResolvedValue(45),
      getFrontmostApp: vi.fn().mockResolvedValue("Finder"),
      getTerminalFrontmost: vi.fn().mockResolvedValue(false),
    })

    const result = await sendActivitySample({ ...baseOptions, provider })

    expect(result.idle_seconds).toBe(45)
    expect(result.is_active).toBe(true) // 45 < 120
    expect(result.frontmost_app).toBe("Finder")
    expect(result.terminal_frontmost).toBe(false)
    expect(result.confidence).toBe("high")
    expect(result.sampled_at).toBeDefined()
  })

  it("marks is_active=false when idle > 120s", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))

    const provider = makeMockProvider({
      getIdleSeconds: vi.fn().mockResolvedValue(180),
    })

    const result = await sendActivitySample({ ...baseOptions, provider })
    expect(result.is_active).toBe(false)
  })

  it("marks is_active=null and confidence='low' when idle is null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))

    const provider = makeMockProvider({
      getIdleSeconds: vi.fn().mockResolvedValue(null),
    })

    const result = await sendActivitySample({ ...baseOptions, provider })
    expect(result.is_active).toBeNull()
    expect(result.confidence).toBe("low")
  })

  it("probes all three activity fields in parallel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })))

    const provider = makeMockProvider()
    await sendActivitySample({ ...baseOptions, provider })

    expect(provider.getIdleSeconds).toHaveBeenCalledOnce()
    expect(provider.getFrontmostApp).toHaveBeenCalledOnce()
    expect(provider.getTerminalFrontmost).toHaveBeenCalledOnce()
  })

  it("strips trailing slash from backendUrl", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    const provider = makeMockProvider()
    await sendActivitySample({ ...baseOptions, backendUrl: "http://localhost:4000/", provider })

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain("//v1")
    expect(url).toContain("/v1/plugin/activity")
  })

  it("throws if the backend returns a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })))

    const provider = makeMockProvider()
    await expect(sendActivitySample({ ...baseOptions, provider })).rejects.toThrow("401")
  })
})

describe("startActivitySampler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("sends a device.activity sample after intervalMs", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    const provider = makeMockProvider()
    const handle = startActivitySampler({
      ...baseOptions,
      provider,
      intervalMs: 1000,
    })

    expect(mockFetch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)

    expect(mockFetch).toHaveBeenCalledOnce()
    handle.stop()
  })

  it("sends multiple samples at each interval", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    const provider = makeMockProvider()
    const handle = startActivitySampler({
      ...baseOptions,
      provider,
      intervalMs: 500,
    })

    await vi.advanceTimersByTimeAsync(1500)
    expect(mockFetch).toHaveBeenCalledTimes(3)
    handle.stop()
  })

  it("stops sending after handle.stop() is called", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    const provider = makeMockProvider()
    const handle = startActivitySampler({
      ...baseOptions,
      provider,
      intervalMs: 500,
    })

    await vi.advanceTimersByTimeAsync(500)
    expect(mockFetch).toHaveBeenCalledOnce()

    handle.stop()

    await vi.advanceTimersByTimeAsync(1000)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it("logs errors but continues running if a sample fails", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"))
    vi.stubGlobal("fetch", mockFetch)

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const provider = makeMockProvider()

    const handle = startActivitySampler({
      ...baseOptions,
      provider,
      intervalMs: 500,
    })

    await vi.advanceTimersByTimeAsync(1000)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalled()

    handle.stop()
    consoleError.mockRestore()
  })
})
