import { type RequestRespondAccepted, RequestRespondRequestSchema } from "@remocode/contracts"
import type { z } from "zod"

import { type ApiErrorCode, ApiHttpError } from "../http/errors"
import { logger } from "../logger"
import { globalMetrics } from "../metrics"
import type { SocketDeltaEmitter } from "../socket/emitter"
import type { PluginAckEnvelope, PluginCommandEnvelope } from "../socket/types"

export type AttentionRequestRow = {
  requestId: string
  userId: string
  deviceId: string
  sessionId: string
  kind: "permission" | "question"
  status: "open" | "resolved" | "rejected" | "expired"
}

export type ActionAttemptRow = {
  status: "accepted" | "failed"
  result: Record<string, unknown>
}

export type RequestRespondStore = {
  getRequest: (args: {
    requestId: string
    userId: string
  }) => Promise<AttentionRequestRow | null>

  getActionAttempt: (args: {
    userId: string
    clientActionId: string
  }) => Promise<ActionAttemptRow | null>

  saveActionAttempt: (args: {
    userId: string
    clientActionId: string
    requestId: string
    status: "accepted" | "failed"
    errorCode: string | null
    result: Record<string, unknown>
  }) => Promise<void>
}

export type PluginRelayFn = (args: {
  deviceId: string
  envelope: PluginCommandEnvelope
  eventType: "action.permission.reply" | "action.question.reply" | "action.question.reject"
}) => Promise<PluginAckEnvelope>

export type RequestRespondService = (args: {
  userId: string
  requestId: string
  payload: unknown
}) => Promise<RequestRespondAccepted>

export function createRequestRespondService(
  store: RequestRespondStore,
  relay: PluginRelayFn,
  socketEmitter?: SocketDeltaEmitter,
): RequestRespondService {
  return async ({ userId, requestId, payload }) => {
    const respondLog = logger.child({ user_id: userId, request_id: requestId })

    // Parse and validate the request body
    const body = RequestRespondRequestSchema.parse(payload)

    // Look up the attention request (ownership check)
    const request = await store.getRequest({ requestId, userId })

    if (!request) {
      respondLog.warn("request not found")
      throw new ApiHttpError("REQUEST_NOT_FOUND")
    }

    // Check request is still open
    if (request.status !== "open") {
      respondLog.warn("request already closed", { status: request.status })
      throw new ApiHttpError("REQUEST_ALREADY_CLOSED")
    }

    const clientActionId = body.client_action_id
    const requestLog = respondLog.child({
      session_id: request.sessionId,
      device_id: request.deviceId,
      client_action_id: clientActionId,
    })

    // Idempotency check: return cached result if we've seen this action before
    const existingAttempt = await store.getActionAttempt({ userId, clientActionId })

    if (existingAttempt) {
      if (existingAttempt.status === "accepted") {
        requestLog.info("action already accepted (idempotent replay)")
        return existingAttempt.result as RequestRespondAccepted
      }

      // Previous attempt failed - re-throw the error
      const errorCode = (existingAttempt.result as { error_code?: string }).error_code
      requestLog.warn("action previously failed (idempotent replay)", { error_code: errorCode })
      throw new ApiHttpError((errorCode as ApiErrorCode | undefined) ?? "INTERNAL_ERROR")
    }

    // Build the command envelope and relay to plugin
    const commandId = crypto.randomUUID()
    const commandLog = requestLog.child({ command_id: commandId })

    let eventType: "action.permission.reply" | "action.question.reply" | "action.question.reject"
    let commandPayload: Record<string, unknown>

    if (body.type === "permission") {
      eventType = "action.permission.reply"
      commandPayload = {
        reply: body.decision,
        ...(body.message !== undefined ? { message: body.message } : {}),
      }
    } else if (body.type === "question" && !("decision" in body)) {
      eventType = "action.question.reply"
      commandPayload = { answers: body.answers }
    } else {
      // question reject
      eventType = "action.question.reject"
      commandPayload = {}
    }

    const envelope: PluginCommandEnvelope = {
      command_id: commandId,
      request_id: requestId,
      session_id: request.sessionId,
      payload: commandPayload,
    }

    commandLog.info("relaying command to plugin", { event_type: eventType })

    let ack: PluginAckEnvelope
    try {
      ack = await relay({ deviceId: request.deviceId, envelope, eventType })
    } catch (err) {
      // relay threw - could be PLUGIN_OFFLINE or RELAY_TIMEOUT
      if (err instanceof ApiHttpError) {
        commandLog.warn("relay failed", { error_code: err.code })
        const relayResult =
          err.code === "PLUGIN_OFFLINE"
            ? "offline"
            : err.code === "RELAY_TIMEOUT"
              ? "timeout"
              : "error"
        globalMetrics.recordRelay(relayResult)
        await store.saveActionAttempt({
          userId,
          clientActionId,
          requestId,
          status: "failed",
          errorCode: err.code,
          result: { error_code: err.code },
        })
        await socketEmitter?.emitRequestFailed(userId, requestId, err.code, err.message)
        throw err
      }
      commandLog.error("relay threw unexpected error")
      globalMetrics.recordRelay("error")
      await store.saveActionAttempt({
        userId,
        clientActionId,
        requestId,
        status: "failed",
        errorCode: "INTERNAL_ERROR",
        result: { error_code: "INTERNAL_ERROR" },
      })
      await socketEmitter?.emitRequestFailed(userId, requestId, "INTERNAL_ERROR", "Internal error")
      throw new ApiHttpError("INTERNAL_ERROR")
    }

    if (!ack.accepted) {
      const errorCode = ack.error ?? "RELAY_EXECUTION_FAILED"
      commandLog.warn("relay ack rejected", { error_code: errorCode })
      globalMetrics.recordRelay("execution_failed")
      await store.saveActionAttempt({
        userId,
        clientActionId,
        requestId,
        status: "failed",
        errorCode,
        result: { error_code: errorCode },
      })
      await socketEmitter?.emitRequestFailed(userId, requestId, errorCode, "Relay execution failed")
      throw new ApiHttpError("RELAY_EXECUTION_FAILED")
    }

    commandLog.info("relay accepted by plugin")
    globalMetrics.recordRelay("success")

    const successResult: RequestRespondAccepted = {
      status: "accepted",
      request_id: requestId,
      relay: "sent",
    }

    await store.saveActionAttempt({
      userId,
      clientActionId,
      requestId,
      status: "accepted",
      errorCode: null,
      result: successResult as unknown as Record<string, unknown>,
    })

    return successResult
  }
}
