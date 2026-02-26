import type { RequestsOpenResponseSchema, SessionsOpenResponseSchema } from "@remocode/contracts"
import type { z } from "zod"

// Events server sends to app clients
export type AppServerToClientEvents = {
  "sessions.delta": (data: z.infer<typeof SessionsOpenResponseSchema>) => void
  "requests.delta": (data: z.infer<typeof RequestsOpenResponseSchema>) => void
  "request.resolved": (data: { request_id: string }) => void
  "request.failed": (data: { request_id: string; code: string; message: string }) => void
}

// Events app clients send to server (none defined for MVP)
export type AppClientToServerEvents = Record<string, never>

// Inter-server events (none for MVP)
export type AppInterServerEvents = Record<string, never>

// Per-socket data stored on the server
export type AppSocketData = {
  userId: string
}
