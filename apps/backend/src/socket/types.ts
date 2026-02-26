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

// Command envelope for server -> plugin events
export type PluginCommandEnvelope<T = Record<string, unknown>> = {
  command_id: string
  request_id: string
  session_id: string
  payload: T
}

// Plugin ack envelope
export type PluginAckEnvelope = {
  command_id: string
  accepted: boolean
  error: string | null
}

// Events server sends to plugin clients
export type PluginServerToClientEvents = {
  "action.permission.reply": (
    data: PluginCommandEnvelope<{ reply: "once" | "always" | "reject"; message?: string }>,
    ack: (ack: PluginAckEnvelope) => void,
  ) => void
  "action.question.reply": (
    data: PluginCommandEnvelope<{ answers: string[][] }>,
    ack: (ack: PluginAckEnvelope) => void,
  ) => void
  "action.question.reject": (
    data: PluginCommandEnvelope,
    ack: (ack: PluginAckEnvelope) => void,
  ) => void
}

// Events plugin clients send to server (none defined for MVP)
export type PluginClientToServerEvents = Record<string, never>

// Inter-server events (none for MVP)
export type PluginInterServerEvents = Record<string, never>

// Per-socket data stored for plugin connections
export type PluginSocketData = {
  userId: string
  deviceId: string
}
