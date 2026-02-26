import { and, eq, inArray } from "drizzle-orm"

import { db } from "../db"
import { devices, sessionProjections } from "../db/schema"
import { getOrCreateDeviceIdForUser } from "../devices/repository"
import { createPluginHeartbeatService } from "./service"

export const runtimePluginHeartbeatService = createPluginHeartbeatService({
  recordHeartbeat: async ({ userId, heartbeat }) => {
    const deviceId = await getOrCreateDeviceIdForUser({
      userId,
      deviceUid: heartbeat.device_uid,
    })

    await db
      .update(devices)
      .set({
        lastSeenAt: new Date(heartbeat.sent_at),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, deviceId))
  },

  updateSessionsHeartbeat: async ({ sessionIds, userId, lastHeartbeatAt }) => {
    await db
      .update(sessionProjections)
      .set({ lastHeartbeatAt, updatedAt: new Date() })
      .where(
        and(
          inArray(sessionProjections.sessionId, sessionIds),
          eq(sessionProjections.userId, userId),
        ),
      )
  },
})
