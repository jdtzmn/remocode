import { describe, expect, it, vi } from "vitest"

import { ApiHttpError } from "../http/errors"
import type { PluginAckEnvelope } from "../socket/types"
import type { ActionAttemptRow, AttentionRequestRow, RequestRespondStore } from "./respond-service"
import { createRequestRespondService } from "./respond-service"

const openPermissionRequest: AttentionRequestRow = {
  requestId: "perm-req-1",
  userId: "user-1",
  deviceId: "device-1",
  sessionId: "session-abc",
  kind: "permission",
  status: "open",
}

const openQuestionRequest: AttentionRequestRow = {
  requestId: "q-req-1",
  userId: "user-1",
  deviceId: "device-1",
  sessionId: "session-abc",
  kind: "question",
  status: "open",
}

function createStore(overrides: Partial<RequestRespondStore> = {}): RequestRespondStore {
  return {
    getRequest: async () => openPermissionRequest,
    getActionAttempt: async () => null,
    saveActionAttempt: async () => undefined,
    ...overrides,
  }
}

function createSuccessRelay(onEmit?: (args: { deviceId: string; eventType: string }) => void) {
  return async (args: {
    deviceId: string
    envelope: { command_id: string }
    eventType: string
  }) => {
    onEmit?.(args)
    return {
      command_id: args.envelope.command_id,
      accepted: true,
      error: null,
    } satisfies PluginAckEnvelope
  }
}

describe("createRequestRespondService", () => {
  it("returns accepted for a valid permission allow-once response", async () => {
    const service = createRequestRespondService(createStore(), createSuccessRelay())

    const result = await service({
      userId: "user-1",
      requestId: "perm-req-1",
      payload: {
        type: "permission",
        decision: "once",
        client_action_id: "11111111-1111-4111-8111-111111111111",
      },
    })

    expect(result).toEqual({
      status: "accepted",
      request_id: "perm-req-1",
      relay: "sent",
    })
  })

  it("emits action.permission.reply for permission response", async () => {
    const emittedArgs: Array<{ deviceId: string; eventType: string }> = []
    const relay = createSuccessRelay((args) => emittedArgs.push(args))
    const service = createRequestRespondService(createStore(), relay)

    await service({
      userId: "user-1",
      requestId: "perm-req-1",
      payload: {
        type: "permission",
        decision: "always",
        client_action_id: "11111111-1111-4111-8111-111111111111",
      },
    })

    expect(emittedArgs).toHaveLength(1)
    expect(emittedArgs[0].eventType).toBe("action.permission.reply")
    expect(emittedArgs[0].deviceId).toBe("device-1")
  })

  it("emits action.question.reply for question answer response", async () => {
    const emittedArgs: Array<{ deviceId: string; eventType: string }> = []
    const relay = createSuccessRelay((args) => emittedArgs.push(args))
    const store = createStore({
      getRequest: async () => openQuestionRequest,
    })
    const service = createRequestRespondService(store, relay)

    await service({
      userId: "user-1",
      requestId: "q-req-1",
      payload: {
        type: "question",
        answers: [["All"]],
        client_action_id: "22222222-2222-4222-8222-222222222222",
      },
    })

    expect(emittedArgs[0].eventType).toBe("action.question.reply")
  })

  it("emits action.question.reject for question reject response", async () => {
    const emittedArgs: Array<{ deviceId: string; eventType: string }> = []
    const relay = createSuccessRelay((args) => emittedArgs.push(args))
    const store = createStore({
      getRequest: async () => openQuestionRequest,
    })
    const service = createRequestRespondService(store, relay)

    await service({
      userId: "user-1",
      requestId: "q-req-1",
      payload: {
        type: "question",
        decision: "reject",
        client_action_id: "33333333-3333-4333-8333-333333333333",
      },
    })

    expect(emittedArgs[0].eventType).toBe("action.question.reject")
  })

  it("throws REQUEST_NOT_FOUND when request does not exist", async () => {
    const store = createStore({ getRequest: async () => null })
    const service = createRequestRespondService(store, createSuccessRelay())

    await expect(
      service({
        userId: "user-1",
        requestId: "nonexistent",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" })
  })

  it("throws REQUEST_ALREADY_CLOSED when request is not open", async () => {
    const closedRequest: AttentionRequestRow = { ...openPermissionRequest, status: "resolved" }
    const store = createStore({ getRequest: async () => closedRequest })
    const service = createRequestRespondService(store, createSuccessRelay())

    await expect(
      service({
        userId: "user-1",
        requestId: "perm-req-1",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).rejects.toMatchObject({ code: "REQUEST_ALREADY_CLOSED" })
  })

  it("throws INVALID_PAYLOAD for malformed request body", async () => {
    const service = createRequestRespondService(createStore(), createSuccessRelay())

    await expect(
      service({
        userId: "user-1",
        requestId: "perm-req-1",
        payload: { type: "unknown-type" },
      }),
    ).rejects.toThrow()
  })

  it("returns cached accepted result for duplicate client_action_id", async () => {
    const cachedResult: ActionAttemptRow = {
      status: "accepted",
      result: {
        status: "accepted",
        request_id: "perm-req-1",
        relay: "sent",
      },
    }
    const relay = vi.fn().mockResolvedValue({ command_id: "x", accepted: true, error: null })
    const store = createStore({
      getActionAttempt: async () => cachedResult,
    })
    const service = createRequestRespondService(store, relay)

    const result = await service({
      userId: "user-1",
      requestId: "perm-req-1",
      payload: {
        type: "permission",
        decision: "once",
        client_action_id: "11111111-1111-4111-8111-111111111111",
      },
    })

    expect(result).toEqual({
      status: "accepted",
      request_id: "perm-req-1",
      relay: "sent",
    })
    // relay should NOT have been called again
    expect(relay).not.toHaveBeenCalled()
  })

  it("re-throws error for duplicate client_action_id with failed attempt", async () => {
    const cachedResult: ActionAttemptRow = {
      status: "failed",
      result: { error_code: "PLUGIN_OFFLINE" },
    }
    const store = createStore({
      getActionAttempt: async () => cachedResult,
    })
    const service = createRequestRespondService(store, createSuccessRelay())

    await expect(
      service({
        userId: "user-1",
        requestId: "perm-req-1",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_OFFLINE" })
  })

  it("propagates PLUGIN_OFFLINE from relay", async () => {
    const relay = async () => {
      throw new ApiHttpError("PLUGIN_OFFLINE")
    }
    const savedAttempts: Array<{ status: string; errorCode: string | null }> = []
    const store = createStore({
      saveActionAttempt: async ({ status, errorCode }) => {
        savedAttempts.push({ status, errorCode })
      },
    })
    const service = createRequestRespondService(store, relay)

    await expect(
      service({
        userId: "user-1",
        requestId: "perm-req-1",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "44444444-4444-4444-8444-444444444444",
        },
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_OFFLINE" })

    expect(savedAttempts).toHaveLength(1)
    expect(savedAttempts[0].status).toBe("failed")
    expect(savedAttempts[0].errorCode).toBe("PLUGIN_OFFLINE")
  })

  it("propagates RELAY_TIMEOUT from relay and saves failed attempt", async () => {
    const relay = async () => {
      throw new ApiHttpError("RELAY_TIMEOUT")
    }
    const savedAttempts: Array<{ status: string; errorCode: string | null }> = []
    const store = createStore({
      saveActionAttempt: async ({ status, errorCode }) => {
        savedAttempts.push({ status, errorCode })
      },
    })
    const service = createRequestRespondService(store, relay)

    await expect(
      service({
        userId: "user-1",
        requestId: "perm-req-1",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "55555555-5555-4555-8555-555555555555",
        },
      }),
    ).rejects.toMatchObject({ code: "RELAY_TIMEOUT" })

    expect(savedAttempts[0].status).toBe("failed")
    expect(savedAttempts[0].errorCode).toBe("RELAY_TIMEOUT")
  })

  it("throws RELAY_EXECUTION_FAILED when ack.accepted is false", async () => {
    const relay = async (args: { envelope: { command_id: string } }) => ({
      command_id: args.envelope.command_id,
      accepted: false,
      error: "plugin_error",
    })
    const service = createRequestRespondService(createStore(), relay)

    await expect(
      service({
        userId: "user-1",
        requestId: "perm-req-1",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "66666666-6666-4666-8666-666666666666",
        },
      }),
    ).rejects.toMatchObject({ code: "RELAY_EXECUTION_FAILED" })
  })

  it("saves accepted action attempt after successful relay", async () => {
    const savedAttempts: Array<{ status: string; requestId: string }> = []
    const store = createStore({
      saveActionAttempt: async ({ status, requestId }) => {
        savedAttempts.push({ status, requestId })
      },
    })
    const service = createRequestRespondService(store, createSuccessRelay())

    await service({
      userId: "user-1",
      requestId: "perm-req-1",
      payload: {
        type: "permission",
        decision: "once",
        client_action_id: "77777777-7777-4777-8777-777777777777",
      },
    })

    expect(savedAttempts).toHaveLength(1)
    expect(savedAttempts[0].status).toBe("accepted")
    expect(savedAttempts[0].requestId).toBe("perm-req-1")
  })

  it("passes message in permission reject payload", async () => {
    let capturedEnvelope: unknown
    const relay = async (args: { envelope: unknown; eventType: string }) => {
      capturedEnvelope = args.envelope
      return {
        command_id: (args.envelope as { command_id: string }).command_id,
        accepted: true,
        error: null,
      } satisfies PluginAckEnvelope
    }
    const service = createRequestRespondService(createStore(), relay)

    await service({
      userId: "user-1",
      requestId: "perm-req-1",
      payload: {
        type: "permission",
        decision: "reject",
        message: "Not safe to run",
        client_action_id: "88888888-8888-4888-8888-888888888888",
      },
    })

    expect((capturedEnvelope as { payload: { message: string } }).payload.message).toBe(
      "Not safe to run",
    )
  })
})
