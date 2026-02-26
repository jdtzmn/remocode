import { and, eq } from "drizzle-orm"
import type { Server } from "socket.io"

import { db } from "../db"
import { actionAttempts, attentionRequests } from "../db/schema"
import { ApiHttpError } from "../http/errors"
import type { SocketDeltaEmitter } from "../socket/emitter"
import type { PluginAckEnvelope, PluginCommandEnvelope } from "../socket/types"
import { createRequestRespondService } from "./respond-service"

const RELAY_TIMEOUT_MS = 8000

/**
 * Creates a relay function that emits commands to the plugin socket
 * and waits for an ack within RELAY_TIMEOUT_MS.
 */
export function createPluginRelay(io: Server) {
  return async function relay(args: {
    deviceId: string
    envelope: PluginCommandEnvelope
    eventType: "action.permission.reply" | "action.question.reply" | "action.question.reject"
  }): Promise<PluginAckEnvelope> {
    const { deviceId, envelope, eventType } = args
    const room = `device:${deviceId}`
    const pluginNs = io.of("/plugin")

    // Check if there's at least one socket in the device room
    const sockets = await pluginNs.in(room).fetchSockets()

    if (sockets.length === 0) {
      throw new ApiHttpError("PLUGIN_OFFLINE")
    }

    return new Promise<PluginAckEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new ApiHttpError("RELAY_TIMEOUT"))
      }, RELAY_TIMEOUT_MS)

      const ackHandler = (ack: PluginAckEnvelope) => {
        clearTimeout(timeout)
        resolve(ack)
      }

      if (eventType === "action.permission.reply") {
        pluginNs
          .in(room)
          .timeout(RELAY_TIMEOUT_MS)
          .emit(
            "action.permission.reply",
            envelope as PluginCommandEnvelope<{
              reply: "once" | "always" | "reject"
              message?: string
            }>,
            ackHandler,
          )
      } else if (eventType === "action.question.reply") {
        pluginNs
          .in(room)
          .timeout(RELAY_TIMEOUT_MS)
          .emit(
            "action.question.reply",
            envelope as PluginCommandEnvelope<{ answers: string[][] }>,
            ackHandler,
          )
      } else {
        pluginNs
          .in(room)
          .timeout(RELAY_TIMEOUT_MS)
          .emit("action.question.reject", envelope, ackHandler)
      }
    })
  }
}

export function createRuntimeRequestRespondService(io: Server, socketEmitter?: SocketDeltaEmitter) {
  const relay = createPluginRelay(io)

  return createRequestRespondService(
    {
      getRequest: async ({ requestId, userId }) => {
        const rows = await db
          .select({
            requestId: attentionRequests.requestId,
            userId: attentionRequests.userId,
            deviceId: attentionRequests.deviceId,
            sessionId: attentionRequests.sessionId,
            kind: attentionRequests.kind,
            status: attentionRequests.status,
          })
          .from(attentionRequests)
          .where(
            and(eq(attentionRequests.requestId, requestId), eq(attentionRequests.userId, userId)),
          )
          .limit(1)

        if (rows.length === 0) {
          return null
        }

        return rows[0]
      },

      getActionAttempt: async ({ userId, clientActionId }) => {
        const rows = await db
          .select({
            status: actionAttempts.status,
            result: actionAttempts.result,
          })
          .from(actionAttempts)
          .where(
            and(
              eq(actionAttempts.userId, userId),
              eq(actionAttempts.clientActionId, clientActionId),
            ),
          )
          .limit(1)

        if (rows.length === 0) {
          return null
        }

        return rows[0]
      },

      saveActionAttempt: async ({
        userId,
        clientActionId,
        requestId,
        status,
        errorCode,
        result,
      }) => {
        await db
          .insert(actionAttempts)
          .values({
            userId,
            clientActionId,
            requestId,
            status,
            errorCode,
            result,
          })
          .onConflictDoNothing({
            target: [actionAttempts.userId, actionAttempts.clientActionId],
          })
      },
    },
    relay,
    socketEmitter,
  )
}
