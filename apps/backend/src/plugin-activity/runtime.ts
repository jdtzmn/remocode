import { eq } from "drizzle-orm"

import { db } from "../db"
import { deviceActivity, devices } from "../db/schema"
import { getOrCreateDeviceIdForUser } from "../devices/repository"
import { createPluginActivityService } from "./service"

export const runtimePluginActivityService = createPluginActivityService({
  recordActivity: async ({ userId, activity }) => {
    const deviceId = await getOrCreateDeviceIdForUser({
      userId,
      deviceUid: activity.device_uid,
    })

    const sampledAt = new Date(activity.sample.sampled_at)

    await db
      .insert(deviceActivity)
      .values({
        deviceId,
        isActive: activity.sample.is_active,
        idleSeconds: activity.sample.idle_seconds,
        frontmostApp: activity.sample.frontmost_app,
        terminalFrontmost: activity.sample.terminal_frontmost,
        confidence: activity.sample.confidence,
        sampledAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: deviceActivity.deviceId,
        set: {
          isActive: activity.sample.is_active,
          idleSeconds: activity.sample.idle_seconds,
          frontmostApp: activity.sample.frontmost_app,
          terminalFrontmost: activity.sample.terminal_frontmost,
          confidence: activity.sample.confidence,
          sampledAt,
          updatedAt: new Date(),
        },
      })

    await db
      .update(devices)
      .set({
        lastSeenAt: sampledAt,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, deviceId))
  },
})
