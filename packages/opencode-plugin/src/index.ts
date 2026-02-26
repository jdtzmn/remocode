import type { Plugin } from "@opencode-ai/plugin"

import { startActivitySampler } from "./activity-sampler"
import { type OpenCodeClient, registerCommandHandlers } from "./command-handler"
import { resolveDeviceUid } from "./device-uid"
import { SessionTracker, startHeartbeat } from "./heartbeat"
import { connectSocket, emitPluginConnected } from "./plugin-startup"
import { createPluginSocket } from "./socket-client"

/**
 * Reads required environment variables for the plugin.
 * Throws if SESSION_AGENT_PAT or SESSION_AGENT_BACKEND_URL are missing.
 */
function readPluginEnv(): {
  pat: string
  backendUrl: string
  deviceName: string | undefined
} {
  const pat = process.env.SESSION_AGENT_PAT
  const backendUrl = process.env.SESSION_AGENT_BACKEND_URL
  const deviceName = process.env.SESSION_AGENT_DEVICE_NAME

  if (!pat) {
    throw new Error("SESSION_AGENT_PAT environment variable is required for the remocode plugin")
  }

  if (!backendUrl) {
    throw new Error(
      "SESSION_AGENT_BACKEND_URL environment variable is required for the remocode plugin",
    )
  }

  return {
    pat,
    backendUrl: backendUrl.replace(/\/$/, ""),
    deviceName: deviceName || undefined,
  }
}

/**
 * RemocodePlugin is an OpenCode plugin that:
 *
 * 1. Reads SESSION_AGENT_PAT and SESSION_AGENT_BACKEND_URL from env.
 * 2. Resolves a stable device_uid from ~/.config/remocode-plugin/device-id.
 * 3. Connects a Socket.IO socket to the backend /plugin namespace.
 * 4. Emits a plugin.connected event via HTTP to signal readiness.
 * 5. Registers command handlers for permission/question unblock actions.
 * 6. Starts a heartbeat timer (15s interval) emitting plugin.heartbeat events.
 * 7. Starts an activity sampler (15s interval) emitting device.activity events.
 *
 * Future extensions (event forwarding) will be added as separate work packages.
 */
export const RemocodePlugin: Plugin = async ({ client, serverUrl }) => {
  let env: ReturnType<typeof readPluginEnv>

  try {
    env = readPluginEnv()
  } catch (err) {
    // Log the error but don't crash OpenCode — plugin is optional
    console.error("[remocode] Plugin startup failed (missing env):", err)
    return {}
  }

  const { pat, backendUrl, deviceName } = env

  // Resolve stable device_uid
  let deviceUid: string

  try {
    deviceUid = await resolveDeviceUid()
  } catch (err) {
    console.error("[remocode] Failed to resolve device_uid:", err)
    return {}
  }

  // Create and connect socket
  const socket = createPluginSocket({
    backendUrl,
    pat,
    deviceUid,
    deviceName,
  })

  try {
    await connectSocket(socket)
  } catch (err) {
    console.error("[remocode] Failed to connect to backend socket:", err)
    // Socket will attempt reconnection automatically
    // Continue startup to register command handlers (they'll work once reconnected)
  }

  // Emit plugin.connected event via HTTP
  try {
    await emitPluginConnected({
      backendUrl,
      pat,
      deviceUid,
      opencodeVersion: "unknown",
      platform: process.platform,
    })
  } catch (err) {
    console.error("[remocode] Failed to emit plugin.connected:", err)
    // Non-fatal — plugin can still function for command handling
  }

  // Register command handlers on the socket
  registerCommandHandlers({
    client: client as unknown as OpenCodeClient,
    serverUrl,
    socket,
  })

  // Create a session tracker that will be updated by the event hook
  const sessionTracker = new SessionTracker()

  // Start heartbeat timer (15s interval)
  startHeartbeat({
    backendUrl,
    pat,
    deviceUid,
    getActiveSessionIds: () => sessionTracker.getActiveSessionIds(),
  })

  // Start activity sampler (15s interval) — sends device.activity events
  startActivitySampler({
    backendUrl,
    pat,
    deviceUid,
  })

  return {
    event: async ({ event }) => {
      // Track session lifecycle events so heartbeat can include active session IDs
      if (event.type === "session.created" || event.type === "session.updated") {
        sessionTracker.addSession(event.properties.info.id)
      } else if (event.type === "session.deleted") {
        sessionTracker.removeSession(event.properties.info.id)
      }
    },
  }
}
