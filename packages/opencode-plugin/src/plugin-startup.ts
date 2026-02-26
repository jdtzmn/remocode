import { randomUUID } from "node:crypto"
import { hostname } from "node:os"

import type { PluginSocketType } from "./socket-client"

export const PLUGIN_VERSION = "1.0.0"

export type PluginStartupOptions = {
  backendUrl: string
  pat: string
  deviceUid: string
  deviceName?: string
  opencodeVersion: string
  platform: NodeJS.Platform
  socket: PluginSocketType
}

type PluginConnectedPayload = {
  plugin_version: string
  opencode_version: string
  platform: string
  hostname: string
  capabilities: {
    activity: boolean
    unblock_permission: boolean
    unblock_question: boolean
  }
}

/**
 * Emits the plugin.connected canonical event to the backend via HTTP POST /v1/plugin/events.
 *
 * This signals that the plugin is alive and specifies its capabilities.
 */
export async function emitPluginConnected(options: {
  backendUrl: string
  pat: string
  deviceUid: string
  opencodeVersion: string
  platform: NodeJS.Platform
}): Promise<void> {
  const { pat, deviceUid, opencodeVersion, platform } = options
  const backendUrl = options.backendUrl.replace(/\/$/, "")

  const payload: PluginConnectedPayload = {
    plugin_version: PLUGIN_VERSION,
    opencode_version: opencodeVersion,
    platform: platform,
    hostname: hostname(),
    capabilities: {
      activity: true,
      unblock_permission: true,
      unblock_question: true,
    },
  }

  const event = {
    event_id: randomUUID(),
    adapter: "opencode",
    adapter_version: PLUGIN_VERSION,
    device_uid: deviceUid,
    event_type: "plugin.connected",
    occurred_at: new Date().toISOString(),
    payload,
  }

  const response = await fetch(`${backendUrl}/v1/plugin/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({ events: [event] }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error")
    throw new Error(`Failed to emit plugin.connected: ${response.status} ${errorText}`)
  }
}

/**
 * Connects the socket to the backend /plugin namespace and waits for the
 * "connect" event. Rejects if the connection fails.
 */
export async function connectSocket(socket: PluginSocketType): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onConnect = () => {
      cleanup()
      resolve()
    }

    const onConnectError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const cleanup = () => {
      socket.off("connect", onConnect)
      socket.off("connect_error", onConnectError)
    }

    socket.once("connect", onConnect)
    socket.once("connect_error", onConnectError)
    socket.connect()
  })
}
