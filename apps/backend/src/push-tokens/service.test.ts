import { describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"

import { ApiHttpError } from "../http/errors"
import {
  type PushTokenRow,
  type PushTokensStore,
  createPushTokenDeleteService,
  createPushTokenRegisterService,
} from "./service"

function makePushTokenRow(overrides: Partial<PushTokenRow> = {}): PushTokenRow {
  return {
    id: "token-1",
    userId: "user-1",
    expoPushToken: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    platform: "ios",
    deviceName: "iPhone 15",
    appVersion: "1.0.0",
    lastSeenAt: new Date("2026-02-22T10:00:00.000Z"),
    revokedAt: null,
    createdAt: new Date("2026-02-22T09:00:00.000Z"),
    ...overrides,
  }
}

function makeStore(overrides: Partial<PushTokensStore> = {}): PushTokensStore {
  return {
    upsertPushToken: vi.fn(async () => makePushTokenRow()),
    deletePushToken: vi.fn(async () => makePushTokenRow()),
    ...overrides,
  }
}

describe("createPushTokenRegisterService", () => {
  it("validates payload and registers a push token", async () => {
    const store = makeStore()
    const service = createPushTokenRegisterService(store)

    const result = await service({
      userId: "user-1",
      payload: {
        expo_push_token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
        platform: "ios",
        device_name: "iPhone 15",
        app_version: "1.0.0",
      },
    })

    expect(result.id).toBe("token-1")
    expect(result.expo_push_token).toBe("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")
    expect(result.platform).toBe("ios")
    expect(result.device_name).toBe("iPhone 15")
    expect(result.app_version).toBe("1.0.0")
    expect(result.created_at).toBe("2026-02-22T09:00:00.000Z")
  })

  it("calls store.upsertPushToken with correct arguments", async () => {
    const store = makeStore()
    const service = createPushTokenRegisterService(store)

    await service({
      userId: "user-1",
      payload: {
        expo_push_token: "ExponentPushToken[abc]",
        platform: "android",
        device_name: "Pixel 7",
        app_version: "2.0.0",
      },
    })

    expect(store.upsertPushToken).toHaveBeenCalledTimes(1)
    const call = (store.upsertPushToken as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      userId: string
      expoPushToken: string
      platform: string
      deviceName: string | null
      appVersion: string | null
      lastSeenAt: Date
    }

    expect(call.userId).toBe("user-1")
    expect(call.expoPushToken).toBe("ExponentPushToken[abc]")
    expect(call.platform).toBe("android")
    expect(call.deviceName).toBe("Pixel 7")
    expect(call.appVersion).toBe("2.0.0")
    expect(call.lastSeenAt).toBeInstanceOf(Date)
  })

  it("registers without optional device_name and app_version", async () => {
    const store = makeStore({
      upsertPushToken: vi.fn(async (args) =>
        makePushTokenRow({ deviceName: args.deviceName, appVersion: args.appVersion }),
      ),
    })
    const service = createPushTokenRegisterService(store)

    const result = await service({
      userId: "user-1",
      payload: {
        expo_push_token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
        platform: "ios",
      },
    })

    expect(result.device_name).toBeNull()
    expect(result.app_version).toBeNull()
  })

  it("rejects invalid payload (missing expo_push_token)", async () => {
    const store = makeStore()
    const service = createPushTokenRegisterService(store)

    await expect(
      service({ userId: "user-1", payload: { platform: "ios" } }),
    ).rejects.toBeInstanceOf(ZodError)
    expect(store.upsertPushToken).not.toHaveBeenCalled()
  })

  it("rejects invalid platform value", async () => {
    const store = makeStore()
    const service = createPushTokenRegisterService(store)

    await expect(
      service({
        userId: "user-1",
        payload: {
          expo_push_token: "ExponentPushToken[xxx]",
          platform: "windows",
        },
      }),
    ).rejects.toBeInstanceOf(ZodError)
  })
})

describe("createPushTokenDeleteService", () => {
  it("deletes a push token and returns ok", async () => {
    const store = makeStore({
      deletePushToken: vi.fn(async () => makePushTokenRow({ revokedAt: new Date() })),
    })
    const service = createPushTokenDeleteService(store)

    const result = await service({ userId: "user-1", pushTokenId: "token-1" })

    expect(result).toEqual({ ok: true })
    expect(store.deletePushToken).toHaveBeenCalledTimes(1)
    const call = (store.deletePushToken as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      pushTokenId: string
      userId: string
    }
    expect(call.pushTokenId).toBe("token-1")
    expect(call.userId).toBe("user-1")
  })

  it("throws REQUEST_NOT_FOUND when token does not exist or already deleted", async () => {
    const store = makeStore({
      deletePushToken: vi.fn(async () => null),
    })
    const service = createPushTokenDeleteService(store)

    const error = await service({ userId: "user-1", pushTokenId: "nonexistent" }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiHttpError)
    expect(error.code).toBe("REQUEST_NOT_FOUND")
  })

  it("uses userId from auth context (cannot delete other user tokens)", async () => {
    const store = makeStore({
      deletePushToken: vi.fn(async () => null),
    })
    const service = createPushTokenDeleteService(store)

    await expect(service({ userId: "user-2", pushTokenId: "token-1" })).rejects.toBeInstanceOf(
      ApiHttpError,
    )

    const call = (store.deletePushToken as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      pushTokenId: string
      userId: string
    }
    expect(call.userId).toBe("user-2")
  })
})
