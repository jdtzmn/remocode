import type { Server } from "socket.io"

import type { PatAuthenticator } from "../auth/pat"
import type {
  PluginClientToServerEvents,
  PluginInterServerEvents,
  PluginServerToClientEvents,
  PluginSocketData,
} from "./types"

// Re-export PluginInterServerEvents (none for MVP)
export type { PluginInterServerEvents }

export type PluginNamespaceServer = Server<
  PluginClientToServerEvents,
  PluginServerToClientEvents,
  PluginInterServerEvents,
  PluginSocketData
>

/**
 * Configures the Socket.IO /plugin namespace.
 *
 * Auth: PAT token extracted from socket handshake `auth.token`.
 *       Device uid extracted from handshake `auth.device_uid`.
 * On success: socket joins `device:{deviceId}` room.
 * On failure: connection is rejected with an error.
 */
export function configurePluginNamespace(
  io: PluginNamespaceServer,
  options: {
    authenticate: PatAuthenticator
    getOrCreateDeviceId: (args: { userId: string; deviceUid: string }) => Promise<string>
  },
): void {
  const pluginNs = io.of("/plugin")

  pluginNs.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth?.token
    const deviceUid: unknown = socket.handshake.auth?.device_uid

    if (typeof token !== "string" || token.length === 0) {
      next(new Error("UNAUTHORIZED"))
      return
    }

    if (typeof deviceUid !== "string" || deviceUid.length === 0) {
      next(new Error("INVALID_PAYLOAD"))
      return
    }

    try {
      const authCtx = await options.authenticate(token)
      const deviceId = await options.getOrCreateDeviceId({
        userId: authCtx.userId,
        deviceUid,
      })

      socket.data.userId = authCtx.userId
      socket.data.deviceId = deviceId
      next()
    } catch {
      next(new Error("UNAUTHORIZED"))
    }
  })

  pluginNs.on("connection", (socket) => {
    const deviceId = socket.data.deviceId
    void socket.join(`device:${deviceId}`)
  })
}
