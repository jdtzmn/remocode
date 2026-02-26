import { and, eq, isNull } from "drizzle-orm"

import { loadEnv } from "../config/env"
import { db } from "../db"
import {
  deviceActivity,
  devices,
  mobilePushTokens,
  notificationLog,
  sessionProjections,
} from "../db/schema"
import { createNotificationEngine } from "./engine"
import { createExpoPushSender } from "./push-sender"

const env = loadEnv()

const runtimePushSender = createExpoPushSender(
  {
    getActiveTokensForUser: async (userId) => {
      const rows = await db
        .select({
          id: mobilePushTokens.id,
          expoPushToken: mobilePushTokens.expoPushToken,
        })
        .from(mobilePushTokens)
        .where(and(eq(mobilePushTokens.userId, userId), isNull(mobilePushTokens.revokedAt)))

      return rows
    },

    revokeToken: async (tokenId) => {
      await db
        .update(mobilePushTokens)
        .set({ revokedAt: new Date() })
        .where(eq(mobilePushTokens.id, tokenId))
    },
  },
  env.EXPO_ACCESS_TOKEN,
)

export const runtimeNotificationEngine = createNotificationEngine({
  getDeviceActivity: async (deviceId) => {
    const rows = await db
      .select({
        isActive: deviceActivity.isActive,
        idleSeconds: deviceActivity.idleSeconds,
        sampledAt: deviceActivity.sampledAt,
      })
      .from(deviceActivity)
      .where(eq(deviceActivity.deviceId, deviceId))
      .limit(1)

    const row = rows[0]
    if (!row) return null

    return {
      isActive: row.isActive,
      idleSeconds: row.idleSeconds,
      sampledAt: row.sampledAt,
    }
  },

  logNotification: async ({ userId, deviceId, requestId, decision, reason, payload }) => {
    await db.insert(notificationLog).values({
      userId,
      deviceId,
      requestId,
      decision,
      reason,
      payload,
      createdAt: new Date(),
    })
  },

  pushSender: runtimePushSender,
})

/**
 * Fetches the session title and device name for notification payload construction.
 * Used as the `getBlockerContext` store method in the runtime ingest service.
 */
export async function getBlockerContext(args: { sessionId: string; deviceId: string }) {
  const [sessionRow, deviceRow] = await Promise.all([
    db
      .select({ title: sessionProjections.title })
      .from(sessionProjections)
      .where(eq(sessionProjections.sessionId, args.sessionId))
      .limit(1),
    db.select({ name: devices.name }).from(devices).where(eq(devices.id, args.deviceId)).limit(1),
  ])

  return {
    sessionTitle: sessionRow[0]?.title ?? null,
    deviceName: deviceRow[0]?.name ?? null,
  }
}
