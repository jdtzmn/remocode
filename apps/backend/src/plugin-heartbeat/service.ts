import { PluginHeartbeatRequestSchema } from "@remocode/contracts"
import type { z } from "zod"

type PluginHeartbeatRequest = z.infer<typeof PluginHeartbeatRequestSchema>

type DeviceHeartbeatStore = {
  recordHeartbeat: (args: { userId: string; heartbeat: PluginHeartbeatRequest }) => Promise<void>
}

export type PluginHeartbeatService = (args: {
  userId: string
  payload: unknown
}) => Promise<{ ok: true }>

export function createPluginHeartbeatService(store: DeviceHeartbeatStore): PluginHeartbeatService {
  return async ({ userId, payload }) => {
    const heartbeat = PluginHeartbeatRequestSchema.parse(payload)

    await store.recordHeartbeat({
      userId,
      heartbeat,
    })

    return { ok: true }
  }
}
