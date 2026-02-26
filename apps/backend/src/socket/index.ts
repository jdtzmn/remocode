import type { ServerType } from "@hono/node-server"
import type { ServerOptions } from "socket.io"
import { Server } from "socket.io"

import type { SupabaseJwtVerifier } from "../auth/supabase"
import { configureAppNamespace } from "./app-namespace"

export type { AppNamespaceServer } from "./app-namespace"
export type { AppClientToServerEvents, AppServerToClientEvents, AppSocketData } from "./types"

export type CreateSocketServerOptions = {
  verifyToken: SupabaseJwtVerifier
  corsOrigin?: string | string[]
  socketOptions?: Partial<ServerOptions>
}

/**
 * Creates and configures the Socket.IO server.
 * Attach to an HTTP server via `attachSocketServer`.
 */
export function createSocketServer(options: CreateSocketServerOptions): Server {
  const io = new Server({
    cors: options.corsOrigin
      ? {
          origin: options.corsOrigin,
          methods: ["GET", "POST"],
        }
      : undefined,
    ...options.socketOptions,
  })

  configureAppNamespace(io, { verifyToken: options.verifyToken })

  return io
}

/**
 * Attaches the Socket.IO server to a Node.js HTTP server returned by
 * `@hono/node-server`'s `serve()`.
 */
export function attachSocketServer(io: Server, httpServer: ServerType): void {
  io.attach(httpServer as Parameters<typeof io.attach>[0])
}
