import { eq } from "drizzle-orm"

import { db } from "../db"
import { deviceActivity, devices, notificationLog, sessionProjections } from "../db/schema"
import { createNotificationEngine } from "./engine"

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
