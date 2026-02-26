import type { Server } from "socket.io"

import type { SupabaseJwtVerifier } from "../auth/supabase"
import { logger } from "../logger"
import type {
  AppClientToServerEvents,
  AppInterServerEvents,
  AppServerToClientEvents,
  AppSocketData,
} from "./types"

export type AppNamespaceServer = Server<
  AppClientToServerEvents,
  AppServerToClientEvents,
  AppInterServerEvents,
  AppSocketData
>

/**
 * Configures the Socket.IO /app namespace.
 *
 * Auth: bearer token extracted from socket handshake `auth.token`.
 * On success: socket joins `user:{userId}` room.
 * On failure: connection is rejected with an error.
 */
export function configureAppNamespace(
  io: AppNamespaceServer,
  options: {
    verifyToken: SupabaseJwtVerifier
  },
): void {
  const appNs = io.of("/app")

  const appNsLog = logger.child({ namespace: "/app" })

  appNs.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth?.token

    if (typeof token !== "string" || token.length === 0) {
      appNsLog.warn("app socket auth rejected: missing token", { socket_id: socket.id })
      next(new Error("UNAUTHORIZED"))
      return
    }

    try {
      const authCtx = await options.verifyToken(token)
      socket.data.userId = authCtx.userId
      next()
    } catch {
      appNsLog.warn("app socket auth rejected: invalid token", { socket_id: socket.id })
      next(new Error("UNAUTHORIZED"))
    }
  })

  appNs.on("connection", (socket) => {
    const userId = socket.data.userId
    void socket.join(`user:${userId}`)
    appNsLog.info("app socket connected", { user_id: userId, socket_id: socket.id })

    socket.on("disconnect", (reason) => {
      appNsLog.info("app socket disconnected", {
        user_id: userId,
        socket_id: socket.id,
        reason,
      })
    })
  })
}
