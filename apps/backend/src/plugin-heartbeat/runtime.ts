import { eq } from "drizzle-orm"

import { db } from "../db"
import { devices } from "../db/schema"
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
})
