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

function makeStore(overrides?: {
  recordHeartbeat?: ReturnType<typeof vi.fn>
  updateSessionsHeartbeat?: ReturnType<typeof vi.fn>
}) {
  return {
    recordHeartbeat: overrides?.recordHeartbeat ?? vi.fn(async () => undefined),
    updateSessionsHeartbeat: overrides?.updateSessionsHeartbeat ?? vi.fn(async () => undefined),
  }
}

describe("createPluginHeartbeatService", () => {
  it("validates payload and records heartbeat", async () => {
    const store = makeStore()
    const service = createPluginHeartbeatService(store)

    await expect(service({ userId: "user-1", payload: heartbeatPayload() })).resolves.toEqual({
      ok: true,
    })

    expect(store.recordHeartbeat).toHaveBeenCalledTimes(1)
    expect(store.recordHeartbeat).toHaveBeenCalledWith({
      userId: "user-1",
      heartbeat: heartbeatPayload(),
    })
  })

  it("updates session heartbeats for active_session_ids", async () => {
    const store = makeStore()
    const service = createPluginHeartbeatService(store)

    await service({ userId: "user-1", payload: heartbeatPayload() })

    expect(store.updateSessionsHeartbeat).toHaveBeenCalledTimes(1)
    const call = store.updateSessionsHeartbeat.mock.calls[0][0] as {
      sessionIds: string[]
      userId: string
      lastHeartbeatAt: Date
    }
    expect(call.sessionIds).toEqual(["session-1"])
    expect(call.userId).toBe("user-1")
    expect(call.lastHeartbeatAt).toBeInstanceOf(Date)
  })

  it("does not call updateSessionsHeartbeat when active_session_ids is empty", async () => {
    const store = makeStore()
    const service = createPluginHeartbeatService(store)

    await service({
      userId: "user-1",
      payload: {
        device_uid: "device-1",
        plugin_version: "1.2.3",
        uptime_sec: 0,
        active_session_ids: [],
        sent_at: "2026-02-22T10:30:00.000Z",
      },
    })

    expect(store.updateSessionsHeartbeat).not.toHaveBeenCalled()
  })

  it("throws on invalid heartbeat payload", async () => {
    const service = createPluginHeartbeatService(makeStore())

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
