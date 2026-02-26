import { and, eq, isNull } from "drizzle-orm"

import { db } from "../db"
import { mobilePushTokens } from "../db/schema"
import {
  type PushTokensStore,
  createPushTokenDeleteService,
  createPushTokenRegisterService,
} from "./service"

const pushTokensStore: PushTokensStore = {
  upsertPushToken: async ({
    userId,
    expoPushToken,
    platform,
    deviceName,
    appVersion,
    lastSeenAt,
  }) => {
    const rows = await db
      .insert(mobilePushTokens)
      .values({
        userId,
        expoPushToken,
        platform,
        deviceName,
        appVersion,
        lastSeenAt,
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: mobilePushTokens.expoPushToken,
        set: {
          userId,
          platform,
          deviceName,
          appVersion,
          lastSeenAt,
          revokedAt: null,
        },
      })
      .returning({
        id: mobilePushTokens.id,
        userId: mobilePushTokens.userId,
        expoPushToken: mobilePushTokens.expoPushToken,
        platform: mobilePushTokens.platform,
        deviceName: mobilePushTokens.deviceName,
        appVersion: mobilePushTokens.appVersion,
        lastSeenAt: mobilePushTokens.lastSeenAt,
        revokedAt: mobilePushTokens.revokedAt,
        createdAt: mobilePushTokens.createdAt,
      })

    const row = rows[0]
    return {
      id: row.id,
      userId: row.userId,
      expoPushToken: row.expoPushToken,
      platform: row.platform,
      deviceName: row.deviceName ?? null,
      appVersion: row.appVersion ?? null,
      lastSeenAt: row.lastSeenAt,
      revokedAt: row.revokedAt ?? null,
      createdAt: row.createdAt,
    }
  },

  deletePushToken: async ({ pushTokenId, userId }) => {
    const rows = await db
      .update(mobilePushTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(mobilePushTokens.id, pushTokenId),
          eq(mobilePushTokens.userId, userId),
          isNull(mobilePushTokens.revokedAt),
        ),
      )
      .returning({
        id: mobilePushTokens.id,
        userId: mobilePushTokens.userId,
        expoPushToken: mobilePushTokens.expoPushToken,
        platform: mobilePushTokens.platform,
        deviceName: mobilePushTokens.deviceName,
        appVersion: mobilePushTokens.appVersion,
        lastSeenAt: mobilePushTokens.lastSeenAt,
        revokedAt: mobilePushTokens.revokedAt,
        createdAt: mobilePushTokens.createdAt,
      })

    if (rows.length === 0) {
      return null
    }

    const row = rows[0]
    return {
      id: row.id,
      userId: row.userId,
      expoPushToken: row.expoPushToken,
      platform: row.platform,
      deviceName: row.deviceName ?? null,
      appVersion: row.appVersion ?? null,
      lastSeenAt: row.lastSeenAt,
      revokedAt: row.revokedAt ?? null,
      createdAt: row.createdAt,
    }
  },
}

export const runtimePushTokenRegisterService = createPushTokenRegisterService(pushTokensStore)
export const runtimePushTokenDeleteService = createPushTokenDeleteService(pushTokensStore)
