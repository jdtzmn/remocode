import { type Socket, io } from "socket.io-client"

// Command envelope matching backend PluginCommandEnvelope type
export type PluginCommandEnvelope<T = Record<string, unknown>> = {
  command_id: string
  request_id: string
  session_id: string
  payload: T
}

// Ack envelope matching backend PluginAckEnvelope type
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

export type PluginSocketType = Socket<PluginServerToClientEvents>

export type PluginSocketOptions = {
  backendUrl: string
  pat: string
  deviceUid: string
  deviceName?: string
}

/**
 * Creates and connects a Socket.IO client to the backend /plugin namespace.
 *
 * Authenticates via PAT token and device_uid in handshake auth.
 * Returns the connected socket.
 */
export function createPluginSocket(options: PluginSocketOptions): PluginSocketType {
  const { backendUrl, pat, deviceUid, deviceName } = options

  const socket: PluginSocketType = io(`${backendUrl}/plugin`, {
    auth: {
      token: pat,
      device_uid: deviceUid,
      device_name: deviceName ?? undefined,
    },
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Number.POSITIVE_INFINITY,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
    autoConnect: false,
  })

  return socket
}
