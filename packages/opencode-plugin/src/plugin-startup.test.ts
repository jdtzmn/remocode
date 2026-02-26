import { beforeEach, describe, expect, it, vi } from "vitest"

import { connectSocket, emitPluginConnected } from "./plugin-startup"
import type { PluginSocketType } from "./socket-client"

describe("emitPluginConnected", () => {
  const baseOptions = {
    backendUrl: "http://localhost:4000",
    pat: "pat_abc_secret123",
    deviceUid: "device-uid-123",
    opencodeVersion: "1.2.3",
    platform: "darwin" as NodeJS.Platform,
  }

  it("POSTs a plugin.connected event to the backend", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    await emitPluginConnected(baseOptions)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]

    expect(url).toBe("http://localhost:4000/v1/plugin/events")
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer pat_abc_secret123",
    })

    const body = JSON.parse(init.body as string) as { events: unknown[] }
    expect(body.events).toHaveLength(1)

    const event = body.events[0] as Record<string, unknown>
    expect(event.event_type).toBe("plugin.connected")
    expect(event.device_uid).toBe("device-uid-123")
    expect(event.adapter).toBe("opencode")

    const payload = event.payload as Record<string, unknown>
    expect(payload.platform).toBe("darwin")
    expect(payload.opencode_version).toBe("1.2.3")
    expect(payload.capabilities).toMatchObject({
      activity: true,
      unblock_permission: true,
      unblock_question: true,
    })

    vi.unstubAllGlobals()
  })

  it("throws if the backend returns a non-OK response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }))
    vi.stubGlobal("fetch", mockFetch)

    await expect(emitPluginConnected(baseOptions)).rejects.toThrow("401")

    vi.unstubAllGlobals()
  })

  it("strips trailing slash from backendUrl", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", mockFetch)

    await emitPluginConnected({ ...baseOptions, backendUrl: "http://localhost:4000/" })

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain("//v1")
    expect(url).toContain("/v1/plugin/events")

    vi.unstubAllGlobals()
  })
})

describe("connectSocket", () => {
  it("resolves when the socket emits connect", async () => {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}

    const socket = {
      once: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handlers[event] ?? []
        handlers[event].push(handler)
      },
      off: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler)
      },
      connect: () => {
        // Simulate connect event firing asynchronously
        setImmediate(() => {
          for (const h of handlers.connect ?? []) {
            h()
          }
        })
      },
    } as unknown as PluginSocketType

    await expect(connectSocket(socket)).resolves.toBeUndefined()
  })

  it("rejects when the socket emits connect_error", async () => {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}

    const socket = {
      once: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handlers[event] ?? []
        handlers[event].push(handler)
      },
      off: (event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler)
      },
      connect: () => {
        setImmediate(() => {
          for (const h of handlers.connect_error ?? []) {
            h(new Error("connection refused"))
          }
        })
      },
    } as unknown as PluginSocketType

    await expect(connectSocket(socket)).rejects.toThrow("connection refused")
  })
})
