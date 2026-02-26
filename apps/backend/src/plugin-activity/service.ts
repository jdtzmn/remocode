import { PluginActivityRequestSchema } from "@remocode/contracts"
import type { z } from "zod"

type PluginActivityRequest = z.infer<typeof PluginActivityRequestSchema>

type DeviceActivityStore = {
  recordActivity: (args: { userId: string; activity: PluginActivityRequest }) => Promise<void>
}

export type PluginActivityService = (args: {
  userId: string
  payload: unknown
}) => Promise<{ ok: true }>

export function createPluginActivityService(store: DeviceActivityStore): PluginActivityService {
  return async ({ userId, payload }) => {
    const activity = PluginActivityRequestSchema.parse(payload)

    await store.recordActivity({
      userId,
      activity,
    })

    return { ok: true }
  }
}
