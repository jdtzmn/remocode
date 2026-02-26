import type { PluginAckEnvelope, PluginCommandEnvelope, PluginSocketType } from "./socket-client"

/**
 * Minimal interface for the OpenCode SDK client methods we need.
 *
 * The plugin receives `client: ReturnType<typeof createOpencodeClient>` from PluginInput.
 * We use the v1 SDK permission API and direct HTTP calls for question operations
 * (which aren't yet in the v1 SDK client).
 */
export type OpenCodeClient = {
  postSessionIdPermissionsPermissionId: (options: {
    body: { response: "once" | "always" | "reject" }
    path: { id: string; permissionID: string }
    query?: { directory?: string }
  }) => Promise<unknown>
}

export type CommandHandlerOptions = {
  client: OpenCodeClient
  serverUrl: URL
  socket: PluginSocketType
}

/**
 * Handles action.permission.reply command from the backend.
 * Calls the local OpenCode SDK to approve/reject a permission request.
 */
async function handlePermissionReply(
  client: OpenCodeClient,
  data: PluginCommandEnvelope<{ reply: "once" | "always" | "reject"; message?: string }>,
): Promise<void> {
  // Map "reject" -> "reject", "once" -> "once", "always" -> "always"
  const response = data.payload.reply

  await client.postSessionIdPermissionsPermissionId({
    body: { response },
    path: {
      id: data.session_id,
      permissionID: data.request_id,
    },
  })
}

/**
 * Handles action.question.reply command from the backend.
 * Calls the local OpenCode HTTP API directly since v1 SDK doesn't have question APIs.
 */
async function handleQuestionReply(
  serverUrl: URL,
  data: PluginCommandEnvelope<{ answers: string[][] }>,
): Promise<void> {
  const url = new URL(`/question/${encodeURIComponent(data.request_id)}/reply`, serverUrl)

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: data.payload.answers }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error")
    throw new Error(`question reply failed: ${response.status} ${errorText}`)
  }
}

/**
 * Handles action.question.reject command from the backend.
 * Calls the local OpenCode HTTP API directly since v1 SDK doesn't have question APIs.
 */
async function handleQuestionReject(serverUrl: URL, data: PluginCommandEnvelope): Promise<void> {
  const url = new URL(`/question/${encodeURIComponent(data.request_id)}/reject`, serverUrl)

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error")
    throw new Error(`question reject failed: ${response.status} ${errorText}`)
  }
}

/**
 * Registers socket command listeners for all action types.
 *
 * Each handler executes the corresponding OpenCode SDK/HTTP call and returns
 * an ack envelope to the backend. Ack means the command was executed;
 * final request closure is driven by the subsequent OpenCode event.
 */
export function registerCommandHandlers(options: CommandHandlerOptions): void {
  const { client, serverUrl, socket } = options

  socket.on("action.permission.reply", async (data, ack) => {
    try {
      await handlePermissionReply(client, data)
      ack({ command_id: data.command_id, accepted: true, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ack({ command_id: data.command_id, accepted: false, error: message })
    }
  })

  socket.on("action.question.reply", async (data, ack) => {
    try {
      await handleQuestionReply(serverUrl, data)
      ack({ command_id: data.command_id, accepted: true, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ack({ command_id: data.command_id, accepted: false, error: message })
    }
  })

  socket.on("action.question.reject", async (data, ack) => {
    try {
      await handleQuestionReject(serverUrl, data)
      ack({ command_id: data.command_id, accepted: true, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ack({ command_id: data.command_id, accepted: false, error: message })
    }
  })
}
