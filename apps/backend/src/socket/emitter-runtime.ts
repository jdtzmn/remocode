import type { Server } from "socket.io"

import type { RequestsOpenService } from "../requests/service"
import type { SessionsOpenService } from "../sessions/service"
import type { SocketDeltaEmitter } from "./emitter"

/**
 * Creates a SocketDeltaEmitter that fetches fresh data via the provided services
 * and emits delta events to the `user:{userId}` room in the /app namespace.
 */
export function createRuntimeSocketDeltaEmitter(
  io: Server,
  services: {
    sessionsOpen: SessionsOpenService
    requestsOpen: RequestsOpenService
  },
): SocketDeltaEmitter {
  const appNs = io.of("/app")

  return {
    emitSessionsDelta: async (userId: string) => {
      const data = await services.sessionsOpen({ userId })
      appNs.to(`user:${userId}`).emit("sessions.delta", data)
    },

    emitRequestsDelta: async (userId: string) => {
      const data = await services.requestsOpen({ userId })
      appNs.to(`user:${userId}`).emit("requests.delta", data)
    },
  }
}
