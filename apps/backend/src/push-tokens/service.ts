import { PushTokenRegisterRequestSchema, type PushTokenRegisterResponse } from "@remocode/contracts"

import { ApiHttpError } from "../http/errors"

export type PushTokenRow = {
  id: string
  userId: string
  expoPushToken: string
  platform: "ios" | "android"
  deviceName: string | null
  appVersion: string | null
  lastSeenAt: Date
  revokedAt: Date | null
  createdAt: Date
}

export type PushTokensStore = {
  upsertPushToken: (args: {
    userId: string
    expoPushToken: string
    platform: "ios" | "android"
    deviceName: string | null
    appVersion: string | null
    lastSeenAt: Date
  }) => Promise<PushTokenRow>
  deletePushToken: (args: { pushTokenId: string; userId: string }) => Promise<PushTokenRow | null>
}

export type PushTokenRegisterService = (args: {
  userId: string
  payload: unknown
}) => Promise<PushTokenRegisterResponse>

export type PushTokenDeleteService = (args: {
  userId: string
  pushTokenId: string
}) => Promise<{ ok: true }>

export function createPushTokenRegisterService(store: PushTokensStore): PushTokenRegisterService {
  return async ({ userId, payload }) => {
    const parsed = PushTokenRegisterRequestSchema.parse(payload)
    const now = new Date()

    const row = await store.upsertPushToken({
      userId,
      expoPushToken: parsed.expo_push_token,
      platform: parsed.platform,
      deviceName: parsed.device_name ?? null,
      appVersion: parsed.app_version ?? null,
      lastSeenAt: now,
    })

    return {
      id: row.id,
      expo_push_token: row.expoPushToken,
      platform: row.platform,
      device_name: row.deviceName,
      app_version: row.appVersion,
      created_at: row.createdAt.toISOString(),
    }
  }
}

export function createPushTokenDeleteService(store: PushTokensStore): PushTokenDeleteService {
  return async ({ userId, pushTokenId }) => {
    const row = await store.deletePushToken({ pushTokenId, userId })

    if (!row) {
      throw new ApiHttpError("REQUEST_NOT_FOUND", {
        message: "Push token not found",
      })
    }

    return { ok: true }
  }
}
