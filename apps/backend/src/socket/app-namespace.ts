import type { Server } from "socket.io"

import type { SupabaseJwtVerifier } from "../auth/supabase"
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

  appNs.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth?.token

    if (typeof token !== "string" || token.length === 0) {
      next(new Error("UNAUTHORIZED"))
      return
    }

    try {
      const authCtx = await options.verifyToken(token)
      socket.data.userId = authCtx.userId
      next()
    } catch {
      next(new Error("UNAUTHORIZED"))
    }
  })

  appNs.on("connection", (socket) => {
    const userId = socket.data.userId
    void socket.join(`user:${userId}`)
  })
}
