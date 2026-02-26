import { PluginHeartbeatRequestSchema } from "@remocode/contracts"
import type { z } from "zod"

type PluginHeartbeatRequest = z.infer<typeof PluginHeartbeatRequestSchema>

type DeviceHeartbeatStore = {
  recordHeartbeat: (args: { userId: string; heartbeat: PluginHeartbeatRequest }) => Promise<void>
  updateSessionsHeartbeat: (args: {
    sessionIds: string[]
    userId: string
    lastHeartbeatAt: Date
  }) => Promise<void>
}

export type PluginHeartbeatService = (args: {
  userId: string
  payload: unknown
}) => Promise<{ ok: true }>

export function createPluginHeartbeatService(store: DeviceHeartbeatStore): PluginHeartbeatService {
  return async ({ userId, payload }) => {
    const heartbeat = PluginHeartbeatRequestSchema.parse(payload)

    const receivedAt = new Date()

    await store.recordHeartbeat({
      userId,
      heartbeat,
    })

    if (heartbeat.active_session_ids.length > 0) {
      await store.updateSessionsHeartbeat({
        sessionIds: heartbeat.active_session_ids,
        userId,
        lastHeartbeatAt: receivedAt,
      })
    }

    return { ok: true }
  }
}
