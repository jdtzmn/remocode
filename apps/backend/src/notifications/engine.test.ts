import { describe, expect, it, vi } from "vitest"

import { createNotificationEngine } from "./engine"
import type { NotificationEngineStore, NotificationTrigger } from "./engine"

function makeTrigger(overrides: Partial<NotificationTrigger> = {}): NotificationTrigger {
  return {
    requestId: "req-1",
    sessionId: "session-1",
    deviceId: "device-1",
    userId: "user-1",
    kind: "permission",
    sessionTitle: "Refactor auth",
    deviceName: "MacBook Pro",
    ...overrides,
  }
}

function makeStore(overrides: Partial<NotificationEngineStore> = {}): NotificationEngineStore {
  return {
    getDeviceActivity: vi.fn().mockResolvedValue(null),
    logNotification: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe("createNotificationEngine", () => {
  it("sends when no activity sample is available and logs decision", async () => {
    const store = makeStore({
      getDeviceActivity: vi.fn().mockResolvedValue(null),
    })

    const engine = createNotificationEngine(store)
    const result = await engine.handleBlocker(makeTrigger())

    expect(result.decision).toBe("send")
    expect(store.logNotification).toHaveBeenCalledOnce()
    expect(store.logNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        deviceId: "device-1",
        requestId: "req-1",
        decision: "sent",
        reason: "no_activity_sample",
      }),
    )
  })

  it("suppresses when device is fresh and active with low idle", async () => {
    const store = makeStore({
      getDeviceActivity: vi.fn().mockResolvedValue({
        isActive: true,
        idleSeconds: 5,
        sampledAt: new Date(),
      }),
    })

    const engine = createNotificationEngine(store)
    const result = await engine.handleBlocker(makeTrigger())

    expect(result.decision).toBe("suppress")
    expect(store.logNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "suppressed",
        reason: "device_active",
      }),
    )
  })

  it("sends when device is inactive", async () => {
    const store = makeStore({
      getDeviceActivity: vi.fn().mockResolvedValue({
        isActive: false,
        idleSeconds: 5,
        sampledAt: new Date(),
      }),
    })

    const engine = createNotificationEngine(store)
    const result = await engine.handleBlocker(makeTrigger())

    expect(result.decision).toBe("send")
    expect(store.logNotification).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "sent", reason: "device_inactive" }),
    )
  })

  it("sends when activity fetch throws (fail-open)", async () => {
    const store = makeStore({
      getDeviceActivity: vi.fn().mockRejectedValue(new Error("DB error")),
    })

    const engine = createNotificationEngine(store)
    const result = await engine.handleBlocker(makeTrigger())

    expect(result.decision).toBe("send")
    expect(store.logNotification).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "sent", reason: "activity_fetch_error" }),
    )
  })

  it("does not throw when logNotification fails", async () => {
    const store = makeStore({
      getDeviceActivity: vi.fn().mockResolvedValue(null),
      logNotification: vi.fn().mockRejectedValue(new Error("log DB error")),
    })

    const engine = createNotificationEngine(store)
    // Should resolve without throwing
    await expect(engine.handleBlocker(makeTrigger())).resolves.toBeDefined()
  })

  it("builds permission notification payload with session title and device name", async () => {
    const store = makeStore()
    const engine = createNotificationEngine(store)

    await engine.handleBlocker(
      makeTrigger({ kind: "permission", sessionTitle: "Refactor auth", deviceName: "MacBook Pro" }),
    )

    const logCall = vi.mocked(store.logNotification).mock.calls[0][0]
    expect(logCall.payload).toMatchObject({
      title: "Action needed: Refactor auth",
      body: "Permission request on MacBook Pro",
      data: {
        request_id: "req-1",
        kind: "permission",
      },
    })
  })

  it("builds question notification payload with session title and device name", async () => {
    const store = makeStore()
    const engine = createNotificationEngine(store)

    await engine.handleBlocker(
      makeTrigger({ kind: "question", sessionTitle: "Fix tests", deviceName: "iMac" }),
    )

    const logCall = vi.mocked(store.logNotification).mock.calls[0][0]
    expect(logCall.payload).toMatchObject({
      title: "Action needed: Fix tests",
      body: "Question on iMac",
    })
  })

  it("handles null sessionTitle and deviceName gracefully", async () => {
    const store = makeStore()
    const engine = createNotificationEngine(store)

    await engine.handleBlocker(makeTrigger({ sessionTitle: null, deviceName: null }))

    const logCall = vi.mocked(store.logNotification).mock.calls[0][0]
    expect(logCall.payload).toMatchObject({
      title: "Action needed",
      body: "Permission request",
    })
  })
})
