import { describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"

import { createPluginHeartbeatService } from "./service"

function heartbeatPayload() {
  return {
    device_uid: "device-1",
    plugin_version: "1.2.3",
    uptime_sec: 90,
    active_session_ids: ["session-1"],
    sent_at: "2026-02-22T10:30:00.000Z",
  }
}

describe("createPluginHeartbeatService", () => {
  it("validates payload and records heartbeat", async () => {
    const recordHeartbeat = vi.fn(async () => undefined)
    const service = createPluginHeartbeatService({ recordHeartbeat })

    await expect(service({ userId: "user-1", payload: heartbeatPayload() })).resolves.toEqual({
      ok: true,
    })

    expect(recordHeartbeat).toHaveBeenCalledTimes(1)
    expect(recordHeartbeat).toHaveBeenCalledWith({
      userId: "user-1",
      heartbeat: heartbeatPayload(),
    })
  })

  it("throws on invalid heartbeat payload", async () => {
    const service = createPluginHeartbeatService({
      recordHeartbeat: async () => undefined,
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
