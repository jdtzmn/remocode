import { describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"

import { createPluginActivityService } from "./service"

function activityPayload() {
  return {
    device_uid: "device-1",
    sample: {
      is_active: true,
      idle_seconds: 0,
      frontmost_app: "Terminal",
      terminal_frontmost: true,
      sampled_at: "2026-02-22T10:30:00.000Z",
      confidence: "high",
    },
  }
}

describe("createPluginActivityService", () => {
  it("validates payload and records device activity", async () => {
    const recordActivity = vi.fn(async () => undefined)
    const service = createPluginActivityService({ recordActivity })

    await expect(service({ userId: "user-1", payload: activityPayload() })).resolves.toEqual({
      ok: true,
    })

    expect(recordActivity).toHaveBeenCalledTimes(1)
    expect(recordActivity).toHaveBeenCalledWith({
      userId: "user-1",
      activity: activityPayload(),
    })
  })

  it("throws on invalid activity payload", async () => {
    const service = createPluginActivityService({
      recordActivity: async () => undefined,
    })

    await expect(
      service({
        userId: "user-1",
        payload: {
          device_uid: "device-1",
        },
      }),
    ).rejects.toBeInstanceOf(ZodError)
  })
})
