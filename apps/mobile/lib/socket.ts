import { type Socket, io } from "socket.io-client"
import type { RequestsOpenResponse, SessionsOpenResponse } from "./api"

// ─── Types ──────────────────────────────────────────────────────────────────

/** Events the server sends to the app client. */
export interface AppServerToClientEvents {
  "sessions.delta": (data: SessionsOpenResponse) => void
  "requests.delta": (data: RequestsOpenResponse) => void
  "request.resolved": (data: { request_id: string }) => void
  "request.failed": (data: { request_id: string; code: string; message: string }) => void
}

/** Events the app client sends to the server (none for MVP). */
export type AppClientToServerEvents = Record<string, never>

export type AppSocket = Socket<AppServerToClientEvents, AppClientToServerEvents>

// ─── Factory ─────────────────────────────────────────────────────────────────

const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL ?? "http://localhost:3000"

/**
 * Creates a Socket.IO connection to the /app namespace authenticated with the
 * provided Supabase JWT.  The socket is NOT auto-connected; call `.connect()`
 * when ready (or pass `autoConnect: true`).
 */
export function createAppSocket(accessToken: string): AppSocket {
  return io(`${SOCKET_URL}/app`, {
    auth: { token: accessToken },
    transports: ["websocket"],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    reconnectionAttempts: Number.POSITIVE_INFINITY,
  }) as AppSocket
}
