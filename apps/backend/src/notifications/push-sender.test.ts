import { describe, expect, it, vi } from "vitest"

import { createExpoPushSender } from "./push-sender"
import type { PushSenderStore, PushTokenRecord } from "./push-sender"

// Mock expo-server-sdk at the module level
vi.mock("expo-server-sdk", () => {
  const sendPushNotificationsAsync = vi.fn()
  const chunkPushNotifications = vi.fn((msgs: unknown[]) => [msgs])

  const ExpoClass = vi.fn(() => ({
    sendPushNotificationsAsync,
    chunkPushNotifications,
  }))

  // Static method
  ;(ExpoClass as unknown as { isExpoPushToken: (t: unknown) => boolean }).isExpoPushToken = (
    token: unknown,
  ) => typeof token === "string" && (token as string).startsWith("ExponentPushToken[")

  return { Expo: ExpoClass }
})

// Re-import after mock — must be dynamic to pick up mock
const getExpoMock = async () => {
  const { Expo } = await import("expo-server-sdk")
  return Expo as unknown as {
    new (
      opts?: unknown,
    ): {
      sendPushNotificationsAsync: ReturnType<typeof vi.fn>
      chunkPushNotifications: ReturnType<typeof vi.fn>
    }
    isExpoPushToken: (t: unknown) => boolean
  }
}

function makeToken(overrides: Partial<PushTokenRecord> = {}): PushTokenRecord {
  return {
    id: "token-1",
    expoPushToken: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    ...overrides,
  }
}

function makeStore(overrides: Partial<PushSenderStore> = {}): PushSenderStore {
  return {
    getActiveTokensForUser: vi.fn().mockResolvedValue([makeToken()]),
    revokeToken: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const defaultPayload = {
  title: "Action needed: Refactor auth",
  body: "Permission request on MacBook Pro",
  data: { request_id: "req-1", kind: "permission" },
}

describe("createExpoPushSender", () => {
  it("returns {sent:0, failed:0} when user has no active tokens", async () => {
    const store = makeStore({
      getActiveTokensForUser: vi.fn().mockResolvedValue([]),
    })
    const sender = createExpoPushSender(store)
    const result = await sender.sendToUser("user-1", defaultPayload)

    expect(result).toEqual({ sent: 0, failed: 0 })
  })

  it("returns {sent:0, failed:0} when token fetch throws (fail-open)", async () => {
    const store = makeStore({
      getActiveTokensForUser: vi.fn().mockRejectedValue(new Error("DB error")),
    })
    const sender = createExpoPushSender(store)
    const result = await sender.sendToUser("user-1", defaultPayload)

    expect(result).toEqual({ sent: 0, failed: 0 })
  })

  it("sends to valid Expo tokens and counts sent", async () => {
    const ExpoMock = await getExpoMock()
    const instance = new ExpoMock()
    instance.sendPushNotificationsAsync.mockResolvedValue([{ status: "ok", id: "receipt-1" }])
    instance.chunkPushNotifications.mockImplementation((msgs: unknown[]) => [msgs])

    const store = makeStore()
    const sender = createExpoPushSender(store)
    const result = await sender.sendToUser("user-1", defaultPayload)

    expect(result.sent).toBe(1)
    expect(result.failed).toBe(0)
  })

  it("counts failed tickets", async () => {
    const ExpoMock = await getExpoMock()
    const instance = new ExpoMock()
    instance.sendPushNotificationsAsync.mockResolvedValue([
      { status: "error", message: "unknown", details: { error: "MessageTooBig" } },
    ])
    instance.chunkPushNotifications.mockImplementation((msgs: unknown[]) => [msgs])

    const store = makeStore()
    const sender = createExpoPushSender(store)
    const result = await sender.sendToUser("user-1", defaultPayload)

    expect(result.failed).toBe(1)
    expect(result.sent).toBe(0)
    // Non-DeviceNotRegistered errors should NOT revoke the token
    expect(store.revokeToken).not.toHaveBeenCalled()
  })

  it("revokes token on DeviceNotRegistered error", async () => {
    const ExpoMock = await getExpoMock()
    const instance = new ExpoMock()
    instance.sendPushNotificationsAsync.mockResolvedValue([
      {
        status: "error",
        message: "The device is not registered",
        details: { error: "DeviceNotRegistered" },
      },
    ])
    instance.chunkPushNotifications.mockImplementation((msgs: unknown[]) => [msgs])

    const store = makeStore()
    const sender = createExpoPushSender(store)
    const result = await sender.sendToUser("user-1", defaultPayload)

    expect(result.failed).toBe(1)
    expect(store.revokeToken).toHaveBeenCalledWith("token-1")
  })

  it("counts entire chunk as failed when sendPushNotificationsAsync throws", async () => {
    const ExpoMock = await getExpoMock()
    const instance = new ExpoMock()
    instance.sendPushNotificationsAsync.mockRejectedValue(new Error("Network error"))
    instance.chunkPushNotifications.mockImplementation((msgs: unknown[]) => [msgs])

    const store = makeStore()
    const sender = createExpoPushSender(store)
    const result = await sender.sendToUser("user-1", defaultPayload)

    expect(result.failed).toBe(1)
    expect(result.sent).toBe(0)
  })

  it("filters out non-Expo tokens", async () => {
    const store = makeStore({
      getActiveTokensForUser: vi
        .fn()
        .mockResolvedValue([{ id: "token-bad", expoPushToken: "not-an-expo-token" }]),
    })
    const sender = createExpoPushSender(store)
    const result = await sender.sendToUser("user-1", defaultPayload)

    expect(result).toEqual({ sent: 0, failed: 0 })
  })

  it("does not throw when revokeToken fails", async () => {
    const ExpoMock = await getExpoMock()
    const instance = new ExpoMock()
    instance.sendPushNotificationsAsync.mockResolvedValue([
      {
        status: "error",
        message: "The device is not registered",
        details: { error: "DeviceNotRegistered" },
      },
    ])
    instance.chunkPushNotifications.mockImplementation((msgs: unknown[]) => [msgs])

    const store = makeStore({
      revokeToken: vi.fn().mockRejectedValue(new Error("DB error")),
    })
    const sender = createExpoPushSender(store)

    // Should resolve without throwing
    await expect(sender.sendToUser("user-1", defaultPayload)).resolves.toBeDefined()
  })
})
