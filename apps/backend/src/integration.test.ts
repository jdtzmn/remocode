/**
 * Integration tests covering cross-cutting scenarios:
 *
 * 1. Ingest idempotency — duplicate event_id must be deduped
 * 2. Action relay to mocked plugin socket — relay emits correct Socket.IO event and returns ack
 * 3. Request lifecycle — open → resolved/rejected via ingest + respond
 * 4. Multi-user data isolation — user A cannot view or act on user B data
 *
 * All tests use in-memory state stores (no database) wired together through real service
 * implementations to exercise actual business logic and integration between layers.
 */

import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { Server } from "socket.io"
import { io as ioc } from "socket.io-client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createAttentionRequestReducer } from "./attention-requests/reducer"
import type { AttentionRequestInput, AttentionRequestStore } from "./attention-requests/reducer"
import { ApiHttpError } from "./http/errors"
import { createPluginEventsIngestService } from "./plugin-events/ingest"
import { createRequestRespondService } from "./requests/respond-service"
import type { AttentionRequestRow, RequestRespondStore } from "./requests/respond-service"
import { createSessionProjectionReducer } from "./session-projections/reducer"
import type {
  SessionProjectionInput,
  SessionProjectionStore,
  SessionProjectionUpdate,
} from "./session-projections/reducer"
import { createSessionsOpenService } from "./sessions/service"
import type { OpenSessionRow } from "./sessions/service"
import { configurePluginNamespace } from "./socket/plugin-namespace"
import type { PluginAckEnvelope, PluginCommandEnvelope } from "./socket/types"

// ---------------------------------------------------------------------------
// In-memory state types
// ---------------------------------------------------------------------------

type EventRecord = {
  eventId: string
  userId: string
  deviceId: string
  eventType: string
  sessionId: string | null
  payload: unknown
}

type SessionRecord = {
  sessionId: string
  userId: string
  deviceId: string
  receivedAt: Date
  title: string | null
  directory: string | null
  sessionState: "busy" | "retry" | "idle" | "unknown"
  isOpen: boolean
  requiresAttention: boolean
  lastEventAt: Date
  isStale: boolean
  attentionCount: number
  lastAttentionAt: Date | null
}

type RequestRecord = AttentionRequestInput & {
  status: "open" | "resolved" | "rejected" | "expired"
}

type ActionAttemptRecord = {
  userId: string
  clientActionId: string
  requestId: string
  status: "accepted" | "failed"
  errorCode: string | null
  result: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// In-memory store factory
// ---------------------------------------------------------------------------

function createInMemoryStores() {
  const events: EventRecord[] = []
  const sessions: Map<string, SessionRecord> = new Map()
  const requests: Map<string, RequestRecord> = new Map()
  const actionAttempts: Map<string, ActionAttemptRecord> = new Map()
  const deviceMap: Map<string, string> = new Map() // "userId:deviceUid" -> deviceId

  // Ingest store
  const ingestStore = {
    getOrCreateDeviceId: async ({ userId, deviceUid }: { userId: string; deviceUid: string }) => {
      const key = `${userId}:${deviceUid}`
      if (!deviceMap.has(key)) {
        deviceMap.set(key, `device:${userId}:${deviceUid}`)
      }
      return deviceMap.get(key) as string
    },
    persistEvent: async ({
      userId,
      deviceId,
      event,
    }: {
      userId: string
      deviceId: string
      event: { event_id: string; event_type: string; session_id?: string | null; payload: unknown }
    }) => {
      const existing = events.find((e) => e.eventId === event.event_id)
      if (existing) return "deduped" as const

      events.push({
        eventId: event.event_id,
        userId,
        deviceId,
        eventType: event.event_type,
        sessionId: event.session_id ?? null,
        payload: event.payload,
      })
      return "accepted" as const
    },
  }

  // Session projection store — matches SessionProjectionStore interface
  const sessionProjectionStore: SessionProjectionStore = {
    upsertSession: vi.fn(async (input: SessionProjectionInput & SessionProjectionUpdate) => {
      const existing = sessions.get(input.sessionId)
      sessions.set(input.sessionId, {
        sessionId: input.sessionId,
        userId: input.userId,
        deviceId: input.deviceId,
        receivedAt: input.receivedAt,
        title: input.title !== undefined ? (input.title ?? null) : (existing?.title ?? null),
        directory:
          input.directory !== undefined ? (input.directory ?? null) : (existing?.directory ?? null),
        sessionState: input.sessionState ?? existing?.sessionState ?? "unknown",
        isOpen: input.isOpen ?? existing?.isOpen ?? true,
        requiresAttention: input.requiresAttention ?? existing?.requiresAttention ?? false,
        lastEventAt: input.lastEventAt ?? existing?.lastEventAt ?? input.receivedAt,
        isStale: existing?.isStale ?? false,
        attentionCount: existing?.attentionCount ?? 0,
        lastAttentionAt: existing?.lastAttentionAt ?? null,
      })
    }),
    updateSession: vi.fn(
      async (sessionId: string, userId: string, update: SessionProjectionUpdate) => {
        const existing = sessions.get(sessionId)
        if (existing && existing.userId === userId) {
          sessions.set(sessionId, { ...existing, ...update })
        }
      },
    ),
    updateSessionsHeartbeat: vi.fn(async () => {}),
  }

  // Attention request store — matches AttentionRequestStore interface
  const attentionRequestStore: AttentionRequestStore = {
    upsertRequest: vi.fn(async (input: AttentionRequestInput) => {
      const existing = requests.get(input.requestId)
      requests.set(input.requestId, {
        ...input,
        status: existing?.status ?? "open",
      })
    }),
    closeRequest: vi.fn(
      async ({
        requestId,
        userId: _userId,
        status,
      }: {
        requestId: string
        userId: string
        status: "resolved" | "rejected"
        resolvedAt: Date
      }) => {
        const existing = requests.get(requestId)
        if (existing) {
          requests.set(requestId, { ...existing, status })
        }
      },
    ),
    countOpenRequests: vi.fn(
      async ({ sessionId, userId }: { sessionId: string; userId: string }) =>
        [...requests.values()].filter(
          (r) => r.sessionId === sessionId && r.userId === userId && r.status === "open",
        ).length,
    ),
    updateSessionAttention: vi.fn(async () => {}),
  }

  // Respond store
  const respondStore: RequestRespondStore = {
    getRequest: async ({ requestId, userId }) => {
      const row = requests.get(requestId)
      if (!row || row.userId !== userId) return null
      return row as AttentionRequestRow
    },
    getActionAttempt: async ({ userId, clientActionId }) => {
      const key = `${userId}:${clientActionId}`
      return actionAttempts.get(key) ?? null
    },
    saveActionAttempt: async ({ userId, clientActionId, requestId, status, errorCode, result }) => {
      const key = `${userId}:${clientActionId}`
      actionAttempts.set(key, { userId, clientActionId, requestId, status, errorCode, result })
    },
  }

  return {
    events,
    sessions,
    requests,
    actionAttempts,
    ingestStore,
    sessionProjectionStore,
    attentionRequestStore,
    respondStore,
  }
}

// ---------------------------------------------------------------------------
// Event factory helpers
// ---------------------------------------------------------------------------

function permissionAskedEvent(
  eventId: string,
  opts: { deviceUid?: string; requestId?: string; sessionId?: string } = {},
) {
  return {
    event_id: eventId,
    adapter: "opencode",
    adapter_version: "1.0.0",
    device_uid: opts.deviceUid ?? "dev-uid-1",
    event_type: "permission.asked",
    session_id: opts.sessionId ?? "session-abc",
    occurred_at: "2026-02-22T10:30:00.000Z",
    payload: {
      id: opts.requestId ?? "perm-01",
      sessionID: opts.sessionId ?? "session-abc",
      permission: "bash",
      patterns: ["npm install"],
      always: [],
      metadata: {},
    },
  }
}

function permissionRepliedEvent(
  eventId: string,
  opts: { deviceUid?: string; requestId?: string; sessionId?: string; reply?: string } = {},
) {
  return {
    event_id: eventId,
    adapter: "opencode",
    adapter_version: "1.0.0",
    device_uid: opts.deviceUid ?? "dev-uid-1",
    event_type: "permission.replied",
    session_id: opts.sessionId ?? "session-abc",
    occurred_at: "2026-02-22T10:31:00.000Z",
    payload: {
      sessionID: opts.sessionId ?? "session-abc",
      requestID: opts.requestId ?? "perm-01",
      reply: opts.reply ?? "once",
    },
  }
}

function questionAskedEvent(
  eventId: string,
  opts: { deviceUid?: string; requestId?: string; sessionId?: string } = {},
) {
  return {
    event_id: eventId,
    adapter: "opencode",
    adapter_version: "1.0.0",
    device_uid: opts.deviceUid ?? "dev-uid-1",
    event_type: "question.asked",
    session_id: opts.sessionId ?? "session-abc",
    occurred_at: "2026-02-22T10:30:00.000Z",
    payload: {
      id: opts.requestId ?? "question-01",
      sessionID: opts.sessionId ?? "session-abc",
      questions: [
        {
          header: "Test Scope",
          question: "Which tests?",
          options: [
            { label: "Unit", description: "Run unit tests only" },
            { label: "All", description: "Run all test suites" },
          ],
        },
      ],
    },
  }
}

function questionRejectedEvent(
  eventId: string,
  opts: { deviceUid?: string; requestId?: string; sessionId?: string } = {},
) {
  return {
    event_id: eventId,
    adapter: "opencode",
    adapter_version: "1.0.0",
    device_uid: opts.deviceUid ?? "dev-uid-1",
    event_type: "question.rejected",
    session_id: opts.sessionId ?? "session-abc",
    occurred_at: "2026-02-22T10:32:00.000Z",
    payload: {
      sessionID: opts.sessionId ?? "session-abc",
      requestID: opts.requestId ?? "question-01",
    },
  }
}

function questionRepliedEvent(
  eventId: string,
  opts: {
    deviceUid?: string
    requestId?: string
    sessionId?: string
    answers?: string[][]
  } = {},
) {
  return {
    event_id: eventId,
    adapter: "opencode",
    adapter_version: "1.0.0",
    device_uid: opts.deviceUid ?? "dev-uid-1",
    event_type: "question.replied",
    session_id: opts.sessionId ?? "session-abc",
    occurred_at: "2026-02-22T10:32:00.000Z",
    payload: {
      sessionID: opts.sessionId ?? "session-abc",
      requestID: opts.requestId ?? "question-01",
      answers: opts.answers ?? [["Unit"]],
    },
  }
}

function sessionCreatedEvent(
  eventId: string,
  opts: { deviceUid?: string; sessionId?: string; title?: string } = {},
) {
  const sessionId = opts.sessionId ?? "session-abc"
  return {
    event_id: eventId,
    adapter: "opencode",
    adapter_version: "1.0.0",
    device_uid: opts.deviceUid ?? "dev-uid-1",
    event_type: "session.created",
    session_id: sessionId,
    occurred_at: "2026-02-22T10:29:00.000Z",
    payload: {
      info: {
        id: sessionId,
        title: opts.title ?? "Refactor auth",
        directory: "/home/user/project",
        projectID: "proj-1",
        version: "1",
        time: { created: 1708559400000, updated: 1708559400000 },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Helper: build a full ingest service with all reducers wired in
// ---------------------------------------------------------------------------

function createFullIngestService(stores: ReturnType<typeof createInMemoryStores>) {
  const projectEvent = createSessionProjectionReducer(stores.sessionProjectionStore)
  const projectAttention = createAttentionRequestReducer(stores.attentionRequestStore)

  return createPluginEventsIngestService({
    ...stores.ingestStore,
    projectEvent,
    projectAttention,
  })
}

// ---------------------------------------------------------------------------
// 1. Ingest idempotency
// ---------------------------------------------------------------------------

describe("Integration: ingest idempotency", () => {
  it("accepts the first occurrence and dedupes subsequent identical event_ids", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)
    const eventId = "11111111-1111-4111-8111-111111111111"

    // First ingest
    const first = await ingest({
      userId: "user-1",
      payload: { events: [permissionAskedEvent(eventId)] },
    })
    expect(first.accepted).toBe(1)
    expect(first.deduped).toBe(0)
    expect(stores.events).toHaveLength(1)

    // Second ingest with same event_id
    const second = await ingest({
      userId: "user-1",
      payload: { events: [permissionAskedEvent(eventId)] },
    })
    expect(second.accepted).toBe(0)
    expect(second.deduped).toBe(1)
    // Event log should still be length 1 — no duplicate row
    expect(stores.events).toHaveLength(1)
  })

  it("dedupes across different users sending the same event_id (globally unique)", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)
    const eventId = "22222222-2222-4222-8222-222222222222"

    const first = await ingest({
      userId: "user-1",
      payload: { events: [sessionCreatedEvent(eventId, { deviceUid: "dev-uid-1" })] },
    })
    expect(first.accepted).toBe(1)

    // Same event_id from user-2 — deduped because event_id is globally unique
    const second = await ingest({
      userId: "user-2",
      payload: {
        events: [
          sessionCreatedEvent(eventId, { deviceUid: "dev-uid-2", sessionId: "session-xyz" }),
        ],
      },
    })
    expect(second.deduped).toBe(1)
  })

  it("accepts events with different event_ids as separate events", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)

    const result = await ingest({
      userId: "user-1",
      payload: {
        events: [
          permissionAskedEvent("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { requestId: "perm-1" }),
          permissionAskedEvent("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
            requestId: "perm-2",
            sessionId: "session-xyz",
          }),
        ],
      },
    })

    expect(result.accepted).toBe(2)
    expect(result.deduped).toBe(0)
    expect(stores.events).toHaveLength(2)
  })

  it("session projection is not updated for deduped events", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)
    const eventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

    // First ingest creates session
    await ingest({
      userId: "user-1",
      payload: { events: [sessionCreatedEvent(eventId)] },
    })
    expect(stores.sessionProjectionStore.upsertSession).toHaveBeenCalledOnce()

    // Second ingest with same event_id — projection should NOT be called again
    await ingest({
      userId: "user-1",
      payload: { events: [sessionCreatedEvent(eventId)] },
    })
    expect(stores.sessionProjectionStore.upsertSession).toHaveBeenCalledOnce() // still once
  })

  it("attention request is not created for deduped blocker events", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)
    const eventId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

    await ingest({
      userId: "user-1",
      payload: { events: [permissionAskedEvent(eventId)] },
    })
    expect(stores.requests.size).toBe(1)

    // Second ingest with same event_id — no new request
    await ingest({
      userId: "user-1",
      payload: { events: [permissionAskedEvent(eventId)] },
    })
    expect(stores.requests.size).toBe(1) // still one request
  })

  it("returns error entry for invalid events but continues processing valid ones", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)

    const result = await ingest({
      userId: "user-1",
      payload: {
        events: [
          sessionCreatedEvent("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
          // Invalid: uptime_sec -1 is invalid for plugin.heartbeat
          {
            event_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            adapter: "opencode",
            adapter_version: "1.0.0",
            device_uid: "dev-uid-1",
            event_type: "plugin.heartbeat",
            occurred_at: "2026-02-22T10:30:00.000Z",
            payload: { uptime_sec: -1, active_session_ids: [], queue_depth: 0 },
          },
          sessionCreatedEvent("11111111-1111-4111-8111-111111111111", { sessionId: "session-2" }),
        ],
      },
    })

    expect(result.accepted).toBe(2)
    expect(result.deduped).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].event_id).toBe("ffffffff-ffff-4fff-8fff-ffffffffffff")
    expect(result.errors[0].code).toBe("INVALID_PAYLOAD")
  })
})

// ---------------------------------------------------------------------------
// 2. Action relay to mocked plugin socket
// ---------------------------------------------------------------------------

function startTestServer(io: Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const httpServer = createServer()
    io.attach(httpServer)
    httpServer.listen(0, "127.0.0.1", () => {
      const { port } = httpServer.address() as AddressInfo
      resolve({
        port,
        close: () =>
          new Promise((res) => {
            io.close(() => {
              httpServer.close(() => res())
            })
          }),
      })
    })
  })
}

/** Build a relay function that routes to a live Socket.IO server with a given timeout. */
function createSocketRelay(
  io: Server,
  timeoutMs = 3000,
): (args: {
  deviceId: string
  envelope: PluginCommandEnvelope
  eventType: "action.permission.reply" | "action.question.reply" | "action.question.reject"
}) => Promise<PluginAckEnvelope> {
  return (args) => {
    const pluginNs = io.of("/plugin")
    return new Promise((resolve, reject) => {
      pluginNs
        .to(`device:${args.deviceId}`)
        .timeout(timeoutMs)
        .emit(args.eventType, args.envelope, (err: Error | null, acks: PluginAckEnvelope[]) => {
          if (err || !acks || acks.length === 0) {
            reject(new ApiHttpError("RELAY_TIMEOUT"))
          } else {
            resolve(acks[0])
          }
        })
    })
  }
}

describe("Integration: action relay to mocked plugin socket", () => {
  let io: Server
  let port: number
  let closeServer: () => Promise<void>
  const validPat = "pat_testprefix_testSecret"
  const userId = "user-relay-1"
  const deviceUid = "device-uid-relay"
  const deviceId = "device-db-relay"

  beforeEach(async () => {
    io = new Server({ transports: ["websocket"] })
    configurePluginNamespace(io, {
      authenticate: async (token) => {
        if (token !== validPat) {
          throw new ApiHttpError("UNAUTHORIZED")
        }
        return { userId, patId: "pat-1", tokenPrefix: "testprefix" }
      },
      getOrCreateDeviceId: async () => deviceId,
    })
    const server = await startTestServer(io)
    port = server.port
    closeServer = server.close
  })

  afterEach(async () => {
    await closeServer()
  })

  it("relays permission.reply to connected plugin socket and receives ack", async () => {
    const stores = createInMemoryStores()
    // Pre-populate an open permission request for this user/device
    stores.requests.set("perm-relay-1", {
      requestId: "perm-relay-1",
      userId,
      deviceId,
      sessionId: "session-relay",
      kind: "permission",
      openedAt: new Date(),
      payload: {},
      status: "open",
    })

    const relay = createSocketRelay(io)
    const respondService = createRequestRespondService(stores.respondStore, relay)

    // Connect a plugin client and set up handler
    const pluginClient = ioc(`http://127.0.0.1:${port}/plugin`, {
      transports: ["websocket"],
      auth: { token: validPat, device_uid: deviceUid },
    })

    const receivedCommands: Array<{ eventType: string; envelope: PluginCommandEnvelope }> = []
    pluginClient.on(
      "action.permission.reply",
      (envelope: PluginCommandEnvelope, ack: (r: PluginAckEnvelope) => void) => {
        receivedCommands.push({ eventType: "action.permission.reply", envelope })
        ack({ command_id: envelope.command_id, accepted: true, error: null })
      },
    )

    await new Promise<void>((resolve, reject) => {
      pluginClient.on("connect", resolve)
      pluginClient.on("connect_error", reject)
    })
    // Small wait for room join to propagate
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    try {
      const result = await respondService({
        userId,
        requestId: "perm-relay-1",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "11111111-1111-4111-8111-111111111111",
        },
      })

      expect(result.status).toBe("accepted")
      expect(result.request_id).toBe("perm-relay-1")
      expect(result.relay).toBe("sent")
      expect(receivedCommands).toHaveLength(1)
      expect(receivedCommands[0].eventType).toBe("action.permission.reply")
      expect(receivedCommands[0].envelope.request_id).toBe("perm-relay-1")
    } finally {
      pluginClient.disconnect()
    }
  })

  it("relays question.reply to connected plugin socket and receives ack", async () => {
    const stores = createInMemoryStores()
    stores.requests.set("question-relay-1", {
      requestId: "question-relay-1",
      userId,
      deviceId,
      sessionId: "session-relay",
      kind: "question",
      openedAt: new Date(),
      payload: {},
      status: "open",
    })

    const relay = createSocketRelay(io)
    const respondService = createRequestRespondService(stores.respondStore, relay)

    const pluginClient = ioc(`http://127.0.0.1:${port}/plugin`, {
      transports: ["websocket"],
      auth: { token: validPat, device_uid: deviceUid },
    })

    const receivedAnswers: string[][][] = []
    pluginClient.on(
      "action.question.reply",
      (
        envelope: PluginCommandEnvelope<{ answers: string[][] }>,
        ack: (r: PluginAckEnvelope) => void,
      ) => {
        receivedAnswers.push(envelope.payload.answers)
        ack({ command_id: envelope.command_id, accepted: true, error: null })
      },
    )

    await new Promise<void>((resolve, reject) => {
      pluginClient.on("connect", resolve)
      pluginClient.on("connect_error", reject)
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    try {
      const result = await respondService({
        userId,
        requestId: "question-relay-1",
        payload: {
          type: "question",
          answers: [["All"]],
          client_action_id: "22222222-2222-4222-8222-222222222222",
        },
      })

      expect(result.status).toBe("accepted")
      expect(receivedAnswers).toEqual([[["All"]]])
    } finally {
      pluginClient.disconnect()
    }
  })

  it("relays question.reject to connected plugin socket and receives ack", async () => {
    const stores = createInMemoryStores()
    stores.requests.set("question-reject-1", {
      requestId: "question-reject-1",
      userId,
      deviceId,
      sessionId: "session-relay",
      kind: "question",
      openedAt: new Date(),
      payload: {},
      status: "open",
    })

    const relay = createSocketRelay(io)
    const respondService = createRequestRespondService(stores.respondStore, relay)

    const pluginClient = ioc(`http://127.0.0.1:${port}/plugin`, {
      transports: ["websocket"],
      auth: { token: validPat, device_uid: deviceUid },
    })

    const receivedRejects: string[] = []
    pluginClient.on(
      "action.question.reject",
      (envelope: PluginCommandEnvelope, ack: (r: PluginAckEnvelope) => void) => {
        receivedRejects.push(envelope.request_id)
        ack({ command_id: envelope.command_id, accepted: true, error: null })
      },
    )

    await new Promise<void>((resolve, reject) => {
      pluginClient.on("connect", resolve)
      pluginClient.on("connect_error", reject)
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    try {
      const result = await respondService({
        userId,
        requestId: "question-reject-1",
        payload: {
          type: "question",
          decision: "reject",
          client_action_id: "33333333-3333-4333-8333-333333333333",
        },
      })

      expect(result.status).toBe("accepted")
      expect(receivedRejects).toContain("question-reject-1")
    } finally {
      pluginClient.disconnect()
    }
  })

  it("returns RELAY_TIMEOUT when no plugin is connected for the device", async () => {
    const stores = createInMemoryStores()
    stores.requests.set("perm-offline", {
      requestId: "perm-offline",
      userId,
      deviceId: "device-not-connected",
      sessionId: "session-relay",
      kind: "permission",
      openedAt: new Date(),
      payload: {},
      status: "open",
    })

    // Very short timeout so test runs fast
    const relay = createSocketRelay(io, 200)
    const respondService = createRequestRespondService(stores.respondStore, relay)

    await expect(
      respondService({
        userId,
        requestId: "perm-offline",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "44444444-4444-4444-8444-444444444444",
        },
      }),
    ).rejects.toMatchObject({ code: "RELAY_TIMEOUT" })

    // Action attempt should be saved as failed
    const savedAttempt = stores.actionAttempts.get(`${userId}:44444444-4444-4444-8444-444444444444`)
    expect(savedAttempt?.status).toBe("failed")
    expect(savedAttempt?.errorCode).toBe("RELAY_TIMEOUT")
  })

  it("relay is idempotent — duplicate client_action_id returns cached result without re-relaying", async () => {
    const stores = createInMemoryStores()
    stores.requests.set("perm-idempotent", {
      requestId: "perm-idempotent",
      userId,
      deviceId,
      sessionId: "session-relay",
      kind: "permission",
      openedAt: new Date(),
      payload: {},
      status: "open",
    })

    let relayCalled = 0
    const relay = vi.fn(
      async (args: { envelope: PluginCommandEnvelope }): Promise<PluginAckEnvelope> => {
        relayCalled++
        return { command_id: args.envelope.command_id, accepted: true, error: null }
      },
    )

    const respondService = createRequestRespondService(stores.respondStore, relay)

    const payload = {
      type: "permission" as const,
      decision: "once" as const,
      client_action_id: "55555555-5555-4555-8555-555555555555",
    }

    // First call
    const first = await respondService({ userId, requestId: "perm-idempotent", payload })
    expect(first.status).toBe("accepted")
    expect(relayCalled).toBe(1)

    // Second call with same client_action_id — returns cached result, no new relay
    const second = await respondService({ userId, requestId: "perm-idempotent", payload })
    expect(second.status).toBe("accepted")
    expect(relayCalled).toBe(1) // relay was NOT called again
  })
})

// ---------------------------------------------------------------------------
// 3. Request lifecycle (open → resolved / rejected)
// ---------------------------------------------------------------------------

describe("Integration: request lifecycle", () => {
  it("permission.asked creates open request, permission.replied closes it as resolved", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)

    // Open the request via ingest
    await ingest({
      userId: "user-1",
      payload: {
        events: [
          permissionAskedEvent("11111111-1111-4111-8111-111111111111", { requestId: "perm-lc-1" }),
        ],
      },
    })

    const openRequest = stores.requests.get("perm-lc-1")
    expect(openRequest).toBeDefined()
    expect(openRequest?.status).toBe("open")
    expect(openRequest?.kind).toBe("permission")

    // Close it via permission.replied
    await ingest({
      userId: "user-1",
      payload: {
        events: [
          permissionRepliedEvent("22222222-2222-4222-8222-222222222222", {
            requestId: "perm-lc-1",
            reply: "once",
          }),
        ],
      },
    })

    const closedRequest = stores.requests.get("perm-lc-1")
    expect(closedRequest?.status).toBe("resolved")
  })

  it("permission.replied with reply=reject closes request as rejected", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)

    await ingest({
      userId: "user-1",
      payload: {
        events: [
          permissionAskedEvent("11111111-1111-4111-8111-111111111111", {
            requestId: "perm-reject-1",
          }),
        ],
      },
    })

    await ingest({
      userId: "user-1",
      payload: {
        events: [
          permissionRepliedEvent("22222222-2222-4222-8222-222222222222", {
            requestId: "perm-reject-1",
            reply: "reject",
          }),
        ],
      },
    })

    const request = stores.requests.get("perm-reject-1")
    expect(request?.status).toBe("rejected")
  })

  it("question.asked creates open question, question.rejected closes it as rejected", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)

    await ingest({
      userId: "user-1",
      payload: {
        events: [
          questionAskedEvent("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
            requestId: "question-lc-1",
          }),
        ],
      },
    })

    expect(stores.requests.get("question-lc-1")?.status).toBe("open")
    expect(stores.requests.get("question-lc-1")?.kind).toBe("question")

    await ingest({
      userId: "user-1",
      payload: {
        events: [
          questionRejectedEvent("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
            requestId: "question-lc-1",
          }),
        ],
      },
    })

    expect(stores.requests.get("question-lc-1")?.status).toBe("rejected")
  })

  it("attention count updates as requests open and close", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)

    // Open two requests for the same session
    await ingest({
      userId: "user-1",
      payload: {
        events: [
          permissionAskedEvent("11111111-1111-4111-8111-111111111111", {
            requestId: "req-1",
            sessionId: "session-multi",
          }),
        ],
      },
    })
    await ingest({
      userId: "user-1",
      payload: {
        events: [
          questionAskedEvent("22222222-2222-4222-8222-222222222222", {
            requestId: "req-2",
            sessionId: "session-multi",
          }),
        ],
      },
    })

    // Both requests are open
    expect(stores.requests.get("req-1")?.status).toBe("open")
    expect(stores.requests.get("req-2")?.status).toBe("open")

    // updateSessionAttention was called for each open event
    expect(stores.attentionRequestStore.updateSessionAttention).toHaveBeenCalled()

    // Close the first request
    await ingest({
      userId: "user-1",
      payload: {
        events: [
          permissionRepliedEvent("33333333-3333-4333-8333-333333333333", {
            requestId: "req-1",
            sessionId: "session-multi",
            reply: "once",
          }),
        ],
      },
    })

    expect(stores.requests.get("req-1")?.status).toBe("resolved")
    expect(stores.requests.get("req-2")?.status).toBe("open") // still open
  })

  it("REQUEST_ALREADY_CLOSED is thrown when trying to respond to a resolved request", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)

    // Open and resolve a request via ingest
    await ingest({
      userId: "user-1",
      payload: {
        events: [
          permissionAskedEvent("11111111-1111-4111-8111-111111111111", {
            requestId: "perm-closed-1",
          }),
        ],
      },
    })
    await ingest({
      userId: "user-1",
      payload: {
        events: [
          permissionRepliedEvent("22222222-2222-4222-8222-222222222222", {
            requestId: "perm-closed-1",
            reply: "once",
          }),
        ],
      },
    })

    // Now try to respond via the respond service — should be rejected
    const relay = vi.fn().mockResolvedValue({ command_id: "cmd-1", accepted: true, error: null })
    const respondService = createRequestRespondService(stores.respondStore, relay)

    await expect(
      respondService({
        userId: "user-1",
        requestId: "perm-closed-1",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "33333333-3333-4333-8333-333333333333",
        },
      }),
    ).rejects.toMatchObject({ code: "REQUEST_ALREADY_CLOSED" })

    // Relay should never have been called
    expect(relay).not.toHaveBeenCalled()
  })

  it("REQUEST_NOT_FOUND is thrown for a non-existent request", async () => {
    const stores = createInMemoryStores()
    const relay = vi.fn()
    const respondService = createRequestRespondService(stores.respondStore, relay)

    await expect(
      respondService({
        userId: "user-1",
        requestId: "does-not-exist",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "44444444-4444-4444-8444-444444444444",
        },
      }),
    ).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" })

    expect(relay).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 4. Multi-user data isolation
// ---------------------------------------------------------------------------

describe("Integration: multi-user data isolation", () => {
  it("ingest for user-A does not affect user-B session projections", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)

    await ingest({
      userId: "user-A",
      payload: {
        events: [
          sessionCreatedEvent("11111111-1111-4111-8111-111111111111", {
            sessionId: "session-A",
            title: "User A Session",
          }),
        ],
      },
    })

    await ingest({
      userId: "user-B",
      payload: {
        events: [
          sessionCreatedEvent("22222222-2222-4222-8222-222222222222", {
            sessionId: "session-B",
            title: "User B Session",
          }),
        ],
      },
    })

    const sessionA = stores.sessions.get("session-A")
    const sessionB = stores.sessions.get("session-B")

    expect(sessionA?.userId).toBe("user-A")
    expect(sessionB?.userId).toBe("user-B")
    expect(sessionA?.title).toBe("User A Session")
    expect(sessionB?.title).toBe("User B Session")
  })

  it("user-A cannot act on user-B requests — returns REQUEST_NOT_FOUND", async () => {
    const stores = createInMemoryStores()

    // Create a request belonging to user-B
    stores.requests.set("req-user-B-1", {
      requestId: "req-user-B-1",
      userId: "user-B",
      deviceId: "device-B",
      sessionId: "session-B",
      kind: "permission",
      openedAt: new Date(),
      payload: {},
      status: "open",
    })

    const relay = vi.fn().mockResolvedValue({ command_id: "cmd-1", accepted: true, error: null })
    const respondService = createRequestRespondService(stores.respondStore, relay)

    // user-A tries to respond to user-B's request — should get NOT_FOUND, not FORBIDDEN
    // (ownership is enforced by returning null for mismatched userId)
    await expect(
      respondService({
        userId: "user-A",
        requestId: "req-user-B-1",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" })

    // Relay was never called
    expect(relay).not.toHaveBeenCalled()
  })

  it("ingest events from user-A only create requests for user-A", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)

    await ingest({
      userId: "user-A",
      payload: {
        events: [
          permissionAskedEvent("11111111-1111-4111-8111-111111111111", {
            requestId: "perm-user-A-1",
            sessionId: "session-A",
          }),
        ],
      },
    })

    await ingest({
      userId: "user-B",
      payload: {
        events: [
          permissionAskedEvent("22222222-2222-4222-8222-222222222222", {
            requestId: "perm-user-B-1",
            sessionId: "session-B",
          }),
        ],
      },
    })

    const reqA = stores.requests.get("perm-user-A-1")
    const reqB = stores.requests.get("perm-user-B-1")

    expect(reqA?.userId).toBe("user-A")
    expect(reqB?.userId).toBe("user-B")
  })

  it("user-A can act on their own request; user-B's request is unaffected", async () => {
    const stores = createInMemoryStores()

    stores.requests.set("req-A", {
      requestId: "req-A",
      userId: "user-A",
      deviceId: "device-A",
      sessionId: "session-A",
      kind: "permission",
      openedAt: new Date(),
      payload: {},
      status: "open",
    })

    stores.requests.set("req-B", {
      requestId: "req-B",
      userId: "user-B",
      deviceId: "device-B",
      sessionId: "session-B",
      kind: "permission",
      openedAt: new Date(),
      payload: {},
      status: "open",
    })

    const relay = vi.fn(
      async (args: {
        deviceId: string
        envelope: PluginCommandEnvelope
      }): Promise<PluginAckEnvelope> => ({
        command_id: args.envelope.command_id,
        accepted: true,
        error: null,
      }),
    )
    const respondService = createRequestRespondService(stores.respondStore, relay)

    // user-A successfully responds to their own request
    const result = await respondService({
      userId: "user-A",
      requestId: "req-A",
      payload: {
        type: "permission",
        decision: "once",
        client_action_id: "11111111-1111-4111-8111-111111111111",
      },
    })
    expect(result.status).toBe("accepted")
    expect(relay).toHaveBeenCalledOnce()
    // Relay was called for device-A specifically
    expect(relay.mock.calls[0][0].deviceId).toBe("device-A")

    // user-B's request remains open and untouched
    expect(stores.requests.get("req-B")?.status).toBe("open")
  })

  it("same device_uid for different users resolves to different internal device IDs", async () => {
    const stores = createInMemoryStores()
    const ingest = createFullIngestService(stores)

    const sharedDeviceUid = "my-macbook"

    await ingest({
      userId: "user-A",
      payload: {
        events: [
          sessionCreatedEvent("11111111-1111-4111-8111-111111111111", {
            deviceUid: sharedDeviceUid,
            sessionId: "session-A",
          }),
        ],
      },
    })

    await ingest({
      userId: "user-B",
      payload: {
        events: [
          sessionCreatedEvent("22222222-2222-4222-8222-222222222222", {
            deviceUid: sharedDeviceUid,
            sessionId: "session-B",
          }),
        ],
      },
    })

    const sessionA = stores.sessions.get("session-A")
    const sessionB = stores.sessions.get("session-B")

    // Device IDs should differ because they are keyed by userId:deviceUid
    expect(sessionA?.deviceId).not.toBe(sessionB?.deviceId)
    expect(sessionA?.deviceId).toBe(`device:user-A:${sharedDeviceUid}`)
    expect(sessionB?.deviceId).toBe(`device:user-B:${sharedDeviceUid}`)
  })

  it("action_attempt idempotency is user-scoped — user-B is not affected by user-A's cached attempt", async () => {
    const stores = createInMemoryStores()

    const sharedClientActionId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"

    stores.requests.set("req-A2", {
      requestId: "req-A2",
      userId: "user-A",
      deviceId: "device-A",
      sessionId: "session-A",
      kind: "permission",
      openedAt: new Date(),
      payload: {},
      status: "open",
    })

    stores.requests.set("req-B2", {
      requestId: "req-B2",
      userId: "user-B",
      deviceId: "device-B",
      sessionId: "session-B",
      kind: "permission",
      openedAt: new Date(),
      payload: {},
      status: "open",
    })

    let relayCalled = 0
    const relay = vi.fn(
      async (args: { envelope: PluginCommandEnvelope }): Promise<PluginAckEnvelope> => {
        relayCalled++
        return { command_id: args.envelope.command_id, accepted: true, error: null }
      },
    )
    const respondService = createRequestRespondService(stores.respondStore, relay)

    // user-A uses the client_action_id
    await respondService({
      userId: "user-A",
      requestId: "req-A2",
      payload: {
        type: "permission",
        decision: "once",
        client_action_id: sharedClientActionId,
      },
    })
    expect(relayCalled).toBe(1)

    // user-B uses the SAME client_action_id — idempotency is user-scoped, so a fresh relay call
    const resultB = await respondService({
      userId: "user-B",
      requestId: "req-B2",
      payload: {
        type: "permission",
        decision: "once",
        client_action_id: sharedClientActionId,
      },
    })
    expect(resultB.status).toBe("accepted")
    expect(relayCalled).toBe(2) // relay was called independently for user-B
  })
})

// ---------------------------------------------------------------------------
// 5. E2E: Multi-device ordering — blocker on lower-ranked device moves group to top
// ---------------------------------------------------------------------------

/**
 * Creates a fully wired in-memory store where updateSessionAttention actually updates
 * session projections, enabling end-to-end ordering tests through createSessionsOpenService.
 */
function createOrderingStores() {
  const events: EventRecord[] = []
  const sessions: Map<string, SessionRecord> = new Map()
  const requests: Map<string, RequestRecord> = new Map()
  const deviceMap: Map<string, string> = new Map() // "userId:deviceUid" -> deviceId

  const ingestStore = {
    getOrCreateDeviceId: async ({ userId, deviceUid }: { userId: string; deviceUid: string }) => {
      const key = `${userId}:${deviceUid}`
      if (!deviceMap.has(key)) {
        deviceMap.set(key, `device:${userId}:${deviceUid}`)
      }
      return deviceMap.get(key) as string
    },
    persistEvent: async ({
      userId,
      deviceId,
      event,
    }: {
      userId: string
      deviceId: string
      event: { event_id: string; event_type: string; session_id?: string | null; payload: unknown }
    }) => {
      const existing = events.find((e) => e.eventId === event.event_id)
      if (existing) return "deduped" as const
      events.push({
        eventId: event.event_id,
        userId,
        deviceId,
        eventType: event.event_type,
        sessionId: event.session_id ?? null,
        payload: event.payload,
      })
      return "accepted" as const
    },
  }

  const sessionProjectionStore: SessionProjectionStore = {
    upsertSession: async (input: SessionProjectionInput & SessionProjectionUpdate) => {
      const existing = sessions.get(input.sessionId)
      sessions.set(input.sessionId, {
        sessionId: input.sessionId,
        userId: input.userId,
        deviceId: input.deviceId,
        receivedAt: input.receivedAt,
        title: input.title !== undefined ? (input.title ?? null) : (existing?.title ?? null),
        directory:
          input.directory !== undefined ? (input.directory ?? null) : (existing?.directory ?? null),
        sessionState: input.sessionState ?? existing?.sessionState ?? "unknown",
        isOpen: input.isOpen ?? existing?.isOpen ?? true,
        requiresAttention: input.requiresAttention ?? existing?.requiresAttention ?? false,
        lastEventAt: input.lastEventAt ?? existing?.lastEventAt ?? input.receivedAt,
        isStale: existing?.isStale ?? false,
        attentionCount: existing?.attentionCount ?? 0,
        lastAttentionAt: existing?.lastAttentionAt ?? null,
      })
    },
    updateSession: async (sessionId: string, userId: string, update: SessionProjectionUpdate) => {
      const existing = sessions.get(sessionId)
      if (existing && existing.userId === userId) {
        sessions.set(sessionId, { ...existing, ...update })
      }
    },
    updateSessionsHeartbeat: async () => {},
  }

  const attentionRequestStore: AttentionRequestStore = {
    upsertRequest: async (input: AttentionRequestInput) => {
      const existing = requests.get(input.requestId)
      requests.set(input.requestId, {
        ...input,
        status: existing?.status ?? "open",
      })
    },
    closeRequest: async ({
      requestId,
      status,
    }: {
      requestId: string
      userId: string
      status: "resolved" | "rejected"
      resolvedAt: Date
    }) => {
      const existing = requests.get(requestId)
      if (existing) {
        requests.set(requestId, { ...existing, status })
      }
    },
    countOpenRequests: async ({ sessionId, userId }: { sessionId: string; userId: string }) =>
      [...requests.values()].filter(
        (r) => r.sessionId === sessionId && r.userId === userId && r.status === "open",
      ).length,
    // Real implementation: update the session projection so ordering reflects attention state
    updateSessionAttention: async ({
      sessionId,
      userId,
      attentionCount,
      requiresAttention,
      lastAttentionAt,
    }: {
      sessionId: string
      userId: string
      attentionCount: number
      requiresAttention: boolean
      lastAttentionAt: Date | null
    }) => {
      const existing = sessions.get(sessionId)
      if (existing && existing.userId === userId) {
        sessions.set(sessionId, {
          ...existing,
          attentionCount,
          requiresAttention,
          lastAttentionAt,
        })
      }
    },
  }

  // Build a sessions-open store that reads directly from our in-memory sessions map
  const sessionsOpenStore = {
    getOpenSessions: async ({ userId }: { userId: string }): Promise<OpenSessionRow[]> => {
      return [...sessions.values()]
        .filter((s) => s.userId === userId && s.isOpen)
        .map((s) => ({
          sessionId: s.sessionId,
          title: s.title,
          sessionState: s.sessionState,
          requiresAttention: s.requiresAttention,
          attentionCount: s.attentionCount,
          lastEventAt: s.lastEventAt,
          lastAttentionAt: s.lastAttentionAt,
          isStale: s.isStale,
          deviceId: s.deviceId,
          // Use device ID as the name for simple inspection in tests
          deviceName: s.deviceId,
          devicePlatform: "darwin",
          deviceLastSeenAt: null,
          activityIsActive: null,
          activityIdleSeconds: null,
          activitySampledAt: null,
        }))
    },
  }

  const actionAttempts: Map<string, ActionAttemptRecord> = new Map()

  // Respond store for E2E tests that also need relay
  const respondStore: RequestRespondStore = {
    getRequest: async ({ requestId, userId: uid }) => {
      const row = requests.get(requestId)
      if (!row || row.userId !== uid) return null
      return row as AttentionRequestRow
    },
    getActionAttempt: async ({ userId: uid, clientActionId }) => {
      const key = `${uid}:${clientActionId}`
      return actionAttempts.get(key) ?? null
    },
    saveActionAttempt: async ({
      userId: uid,
      clientActionId,
      requestId,
      status,
      errorCode,
      result,
    }) => {
      const key = `${uid}:${clientActionId}`
      actionAttempts.set(key, { userId: uid, clientActionId, requestId, status, errorCode, result })
    },
  }

  return {
    events,
    sessions,
    requests,
    actionAttempts,
    ingestStore,
    sessionProjectionStore,
    attentionRequestStore,
    sessionsOpenStore,
    respondStore,
  }
}

function createFullOrderingServices(stores: ReturnType<typeof createOrderingStores>) {
  const projectEvent = createSessionProjectionReducer(stores.sessionProjectionStore)
  const projectAttention = createAttentionRequestReducer(stores.attentionRequestStore)

  const ingest = createPluginEventsIngestService({
    ...stores.ingestStore,
    projectEvent,
    projectAttention,
  })

  const sessionsOpen = createSessionsOpenService(stores.sessionsOpenStore)

  return { ingest, sessionsOpen }
}

// ---------------------------------------------------------------------------
// 6. E2E: Permission unblock round-trip
// ---------------------------------------------------------------------------
//
// Scenario:
//   1. plugin.connected + session.created arrive via ingest
//   2. permission.asked arrives — request is open, session requires_attention=true, badge=1
//   3. App sends "Allow once" via respond service — command relayed to live plugin socket
//   4. Plugin acks the command and then ingests permission.replied (simulating OpenCode callback)
//   5. Request is closed as resolved, session requires_attention=false, attention_count=0

describe("E2E: permission unblock round-trip", () => {
  let io: Server
  let port: number
  let closeServer: () => Promise<void>
  const validPat = "pat_e2eperm_testSecret"
  const userId = "user-perm-e2e"
  const deviceUid = "dev-perm-uid"

  beforeEach(async () => {
    io = new Server({ transports: ["websocket"] })
    configurePluginNamespace(io, {
      authenticate: async (token) => {
        if (token !== validPat) throw new ApiHttpError("UNAUTHORIZED")
        return { userId, patId: "pat-perm-e2e", tokenPrefix: "e2eperm" }
      },
      getOrCreateDeviceId: async () => `device:${userId}:${deviceUid}`,
    })
    const server = await startTestServer(io)
    port = server.port
    closeServer = server.close
  })

  afterEach(async () => {
    await closeServer()
  })

  it("permission.asked → Allow once → permission.replied → badge decrements to 0", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)
    const deviceId = `device:${userId}:${deviceUid}`

    // Step 1: session.created
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
            deviceUid,
            sessionId: "session-perm-e2e",
            title: "E2E Permission Test Session",
          }),
        ],
      },
    })

    // Step 2: permission.asked — blocker opens
    await ingest({
      userId,
      payload: {
        events: [
          permissionAskedEvent("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
            deviceUid,
            requestId: "perm-e2e-round-trip",
            sessionId: "session-perm-e2e",
          }),
        ],
      },
    })

    // Verify: request is open, badge is 1, requires_attention is true
    const openRequest = stores.requests.get("perm-e2e-round-trip")
    expect(openRequest?.status).toBe("open")
    expect(openRequest?.kind).toBe("permission")

    const afterAskedResult = await sessionsOpen({ userId })
    expect(afterAskedResult.groups).toHaveLength(1)
    expect(afterAskedResult.groups[0].sessions[0].requires_attention).toBe(true)
    expect(afterAskedResult.groups[0].sessions[0].attention_count).toBe(1)

    // Step 3: Connect plugin client and handle the command
    const pluginClient = ioc(`http://127.0.0.1:${port}/plugin`, {
      transports: ["websocket"],
      auth: { token: validPat, device_uid: deviceUid },
    })

    // Track what the plugin receives + simulate ingesting permission.replied
    const pluginReceivedReplies: Array<{ reply: string }> = []

    pluginClient.on(
      "action.permission.reply",
      async (
        envelope: PluginCommandEnvelope<{ reply: string }>,
        ack: (r: PluginAckEnvelope) => void,
      ) => {
        pluginReceivedReplies.push({ reply: envelope.payload.reply })
        // Ack the command
        ack({ command_id: envelope.command_id, accepted: true, error: null })

        // Step 4: Plugin simulates OpenCode callback — emits permission.replied back via ingest
        await ingest({
          userId,
          payload: {
            events: [
              permissionRepliedEvent("cccccccc-cccc-4ccc-8ccc-cccccccccccc", {
                deviceUid,
                requestId: "perm-e2e-round-trip",
                sessionId: "session-perm-e2e",
                reply: envelope.payload.reply,
              }),
            ],
          },
        })
      },
    )

    await new Promise<void>((resolve, reject) => {
      pluginClient.on("connect", resolve)
      pluginClient.on("connect_error", reject)
    })
    // Wait for room join to propagate
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    try {
      // Step 3 (cont): App sends "Allow once" decision
      const relay = createSocketRelay(io)
      const respondService = createRequestRespondService(stores.respondStore, relay)

      const respondResult = await respondService({
        userId,
        requestId: "perm-e2e-round-trip",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        },
      })

      // Respond service returns accepted
      expect(respondResult.status).toBe("accepted")
      expect(respondResult.relay).toBe("sent")

      // Plugin received "once" reply
      expect(pluginReceivedReplies).toHaveLength(1)
      expect(pluginReceivedReplies[0].reply).toBe("once")

      // Step 5: Wait for the permission.replied ingest to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 100))

      // Verify: request is now resolved
      const closedRequest = stores.requests.get("perm-e2e-round-trip")
      expect(closedRequest?.status).toBe("resolved")

      // Badge decrements to 0, requires_attention is false
      const afterResolvedResult = await sessionsOpen({ userId })
      expect(afterResolvedResult.groups).toHaveLength(1)
      expect(afterResolvedResult.groups[0].sessions[0].requires_attention).toBe(false)
      expect(afterResolvedResult.groups[0].sessions[0].attention_count).toBe(0)
      expect(afterResolvedResult.groups[0].device.id).toBe(deviceId)
    } finally {
      pluginClient.disconnect()
    }
  })

  it("permission.asked → Reject → permission.replied(reject) → request rejected, badge=0", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)

    // Create session and blocker
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", {
            deviceUid,
            sessionId: "session-reject-e2e",
            title: "E2E Reject Test Session",
          }),
        ],
      },
    })

    await ingest({
      userId,
      payload: {
        events: [
          permissionAskedEvent("ffffffff-ffff-4fff-8fff-ffffffffffff", {
            deviceUid,
            requestId: "perm-reject-e2e",
            sessionId: "session-reject-e2e",
          }),
        ],
      },
    })

    expect(stores.requests.get("perm-reject-e2e")?.status).toBe("open")

    const pluginClient = ioc(`http://127.0.0.1:${port}/plugin`, {
      transports: ["websocket"],
      auth: { token: validPat, device_uid: deviceUid },
    })

    pluginClient.on(
      "action.permission.reply",
      async (
        envelope: PluginCommandEnvelope<{ reply: string }>,
        ack: (r: PluginAckEnvelope) => void,
      ) => {
        ack({ command_id: envelope.command_id, accepted: true, error: null })

        // Plugin ingests permission.replied with reject
        await ingest({
          userId,
          payload: {
            events: [
              permissionRepliedEvent("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
                deviceUid,
                requestId: "perm-reject-e2e",
                sessionId: "session-reject-e2e",
                reply: "reject",
              }),
            ],
          },
        })
      },
    )

    await new Promise<void>((resolve, reject) => {
      pluginClient.on("connect", resolve)
      pluginClient.on("connect_error", reject)
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    try {
      const relay = createSocketRelay(io)
      const respondService = createRequestRespondService(stores.respondStore, relay)

      await respondService({
        userId,
        requestId: "perm-reject-e2e",
        payload: {
          type: "permission",
          decision: "reject",
          client_action_id: "22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 100))

      // Request should be rejected (not resolved)
      expect(stores.requests.get("perm-reject-e2e")?.status).toBe("rejected")

      // Badge should be 0, no attention required
      const afterReject = await sessionsOpen({ userId })
      expect(afterReject.groups[0].sessions[0].requires_attention).toBe(false)
      expect(afterReject.groups[0].sessions[0].attention_count).toBe(0)
    } finally {
      pluginClient.disconnect()
    }
  })

  it("Allow for this run (always) follows same path — badge decrements", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)

    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
            deviceUid,
            sessionId: "session-always-e2e",
            title: "E2E Always Test Session",
          }),
        ],
      },
    })

    await ingest({
      userId,
      payload: {
        events: [
          permissionAskedEvent("44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
            deviceUid,
            requestId: "perm-always-e2e",
            sessionId: "session-always-e2e",
          }),
        ],
      },
    })

    const pluginClient = ioc(`http://127.0.0.1:${port}/plugin`, {
      transports: ["websocket"],
      auth: { token: validPat, device_uid: deviceUid },
    })

    pluginClient.on(
      "action.permission.reply",
      async (
        envelope: PluginCommandEnvelope<{ reply: string }>,
        ack: (r: PluginAckEnvelope) => void,
      ) => {
        ack({ command_id: envelope.command_id, accepted: true, error: null })

        await ingest({
          userId,
          payload: {
            events: [
              permissionRepliedEvent("55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
                deviceUid,
                requestId: "perm-always-e2e",
                sessionId: "session-always-e2e",
                reply: "always",
              }),
            ],
          },
        })
      },
    )

    await new Promise<void>((resolve, reject) => {
      pluginClient.on("connect", resolve)
      pluginClient.on("connect_error", reject)
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    try {
      const relay = createSocketRelay(io)
      const respondService = createRequestRespondService(stores.respondStore, relay)

      const result = await respondService({
        userId,
        requestId: "perm-always-e2e",
        payload: {
          type: "permission",
          decision: "always",
          client_action_id: "66666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      })

      expect(result.status).toBe("accepted")

      await new Promise<void>((resolve) => setTimeout(resolve, 100))

      // Request resolved (always → resolved)
      expect(stores.requests.get("perm-always-e2e")?.status).toBe("resolved")

      // Badge decremented
      const afterAlways = await sessionsOpen({ userId })
      expect(afterAlways.groups[0].sessions[0].requires_attention).toBe(false)
      expect(afterAlways.groups[0].sessions[0].attention_count).toBe(0)
    } finally {
      pluginClient.disconnect()
    }
  })
})

// ---------------------------------------------------------------------------
// 7. E2E: Question unblock round-trip
// ---------------------------------------------------------------------------
//
// Scenario:
//   1. plugin.connected + session.created arrive via ingest
//   2. question.asked arrives — request is open, session requires_attention=true, badge=1
//   3. App submits answers via respond service — command relayed to live plugin socket
//   4. Plugin acks the command and then ingests question.replied (simulating OpenCode callback)
//   5. Request is closed as resolved, session requires_attention=false, attention_count=0
//
//   Variant: App rejects the question — plugin ingests question.rejected → status=rejected, badge=0

describe("E2E: question unblock round-trip", () => {
  let io: Server
  let port: number
  let closeServer: () => Promise<void>
  const validPat = "pat_e2equest_testSecret"
  const userId = "user-quest-e2e"
  const deviceUid = "dev-quest-uid"

  beforeEach(async () => {
    io = new Server({ transports: ["websocket"] })
    configurePluginNamespace(io, {
      authenticate: async (token) => {
        if (token !== validPat) throw new ApiHttpError("UNAUTHORIZED")
        return { userId, patId: "pat-quest-e2e", tokenPrefix: "e2equest" }
      },
      getOrCreateDeviceId: async () => `device:${userId}:${deviceUid}`,
    })
    const server = await startTestServer(io)
    port = server.port
    closeServer = server.close
  })

  afterEach(async () => {
    await closeServer()
  })

  it("question.asked → submit answers → question.replied → badge decrements to 0", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)
    const deviceId = `device:${userId}:${deviceUid}`

    // Step 1: session.created
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("aa000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
            deviceUid,
            sessionId: "session-quest-e2e",
            title: "E2E Question Test Session",
          }),
        ],
      },
    })

    // Step 2: question.asked — blocker opens
    await ingest({
      userId,
      payload: {
        events: [
          questionAskedEvent("aa000002-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
            deviceUid,
            requestId: "quest-e2e-round-trip",
            sessionId: "session-quest-e2e",
          }),
        ],
      },
    })

    // Verify: request is open, badge is 1, requires_attention is true
    const openRequest = stores.requests.get("quest-e2e-round-trip")
    expect(openRequest?.status).toBe("open")
    expect(openRequest?.kind).toBe("question")

    const afterAskedResult = await sessionsOpen({ userId })
    expect(afterAskedResult.groups).toHaveLength(1)
    expect(afterAskedResult.groups[0].sessions[0].requires_attention).toBe(true)
    expect(afterAskedResult.groups[0].sessions[0].attention_count).toBe(1)

    // Step 3: Connect plugin client and handle the command
    const pluginClient = ioc(`http://127.0.0.1:${port}/plugin`, {
      transports: ["websocket"],
      auth: { token: validPat, device_uid: deviceUid },
    })

    // Track what the plugin receives + simulate ingesting question.replied
    const pluginReceivedAnswers: string[][][] = []

    pluginClient.on(
      "action.question.reply",
      async (
        envelope: PluginCommandEnvelope<{ answers: string[][] }>,
        ack: (r: PluginAckEnvelope) => void,
      ) => {
        pluginReceivedAnswers.push(envelope.payload.answers)
        // Ack the command
        ack({ command_id: envelope.command_id, accepted: true, error: null })

        // Step 4: Plugin simulates OpenCode callback — ingests question.replied
        await ingest({
          userId,
          payload: {
            events: [
              questionRepliedEvent("aa000003-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
                deviceUid,
                requestId: "quest-e2e-round-trip",
                sessionId: "session-quest-e2e",
                answers: envelope.payload.answers,
              }),
            ],
          },
        })
      },
    )

    await new Promise<void>((resolve, reject) => {
      pluginClient.on("connect", resolve)
      pluginClient.on("connect_error", reject)
    })
    // Wait for room join to propagate
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    try {
      // Step 3 (cont): App submits answers
      const relay = createSocketRelay(io)
      const respondService = createRequestRespondService(stores.respondStore, relay)

      const respondResult = await respondService({
        userId,
        requestId: "quest-e2e-round-trip",
        payload: {
          type: "question",
          answers: [["All"]],
          client_action_id: "aa000004-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      })

      // Respond service returns accepted
      expect(respondResult.status).toBe("accepted")
      expect(respondResult.relay).toBe("sent")

      // Plugin received the answers
      expect(pluginReceivedAnswers).toHaveLength(1)
      expect(pluginReceivedAnswers[0]).toEqual([["All"]])

      // Step 5: Wait for the question.replied ingest to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 100))

      // Verify: request is now resolved
      const closedRequest = stores.requests.get("quest-e2e-round-trip")
      expect(closedRequest?.status).toBe("resolved")

      // Badge decrements to 0, requires_attention is false
      const afterResolvedResult = await sessionsOpen({ userId })
      expect(afterResolvedResult.groups).toHaveLength(1)
      expect(afterResolvedResult.groups[0].sessions[0].requires_attention).toBe(false)
      expect(afterResolvedResult.groups[0].sessions[0].attention_count).toBe(0)
      expect(afterResolvedResult.groups[0].device.id).toBe(deviceId)
    } finally {
      pluginClient.disconnect()
    }
  })

  it("question.asked → reject → question.rejected → request rejected, badge=0", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)

    // Create session and blocker
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("bb000001-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
            deviceUid,
            sessionId: "session-quest-reject-e2e",
            title: "E2E Question Reject Session",
          }),
        ],
      },
    })

    await ingest({
      userId,
      payload: {
        events: [
          questionAskedEvent("bb000002-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
            deviceUid,
            requestId: "quest-reject-e2e",
            sessionId: "session-quest-reject-e2e",
          }),
        ],
      },
    })

    expect(stores.requests.get("quest-reject-e2e")?.status).toBe("open")

    const pluginClient = ioc(`http://127.0.0.1:${port}/plugin`, {
      transports: ["websocket"],
      auth: { token: validPat, device_uid: deviceUid },
    })

    pluginClient.on(
      "action.question.reject",
      async (envelope: PluginCommandEnvelope, ack: (r: PluginAckEnvelope) => void) => {
        ack({ command_id: envelope.command_id, accepted: true, error: null })

        // Plugin ingests question.rejected
        await ingest({
          userId,
          payload: {
            events: [
              questionRejectedEvent("bb000003-bbbb-4bbb-8bbb-bbbbbbbbbbbb", {
                deviceUid,
                requestId: "quest-reject-e2e",
                sessionId: "session-quest-reject-e2e",
              }),
            ],
          },
        })
      },
    )

    await new Promise<void>((resolve, reject) => {
      pluginClient.on("connect", resolve)
      pluginClient.on("connect_error", reject)
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    try {
      const relay = createSocketRelay(io)
      const respondService = createRequestRespondService(stores.respondStore, relay)

      await respondService({
        userId,
        requestId: "quest-reject-e2e",
        payload: {
          type: "question",
          decision: "reject",
          client_action_id: "bb000004-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      })

      await new Promise<void>((resolve) => setTimeout(resolve, 100))

      // Request should be rejected (not resolved)
      expect(stores.requests.get("quest-reject-e2e")?.status).toBe("rejected")

      // Badge should be 0, no attention required
      const afterReject = await sessionsOpen({ userId })
      expect(afterReject.groups[0].sessions[0].requires_attention).toBe(false)
      expect(afterReject.groups[0].sessions[0].attention_count).toBe(0)
    } finally {
      pluginClient.disconnect()
    }
  })

  it("question.asked with multiple questions — answers relayed correctly, badge decrements", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)

    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("cc000001-cccc-4ccc-8ccc-cccccccccccc", {
            deviceUid,
            sessionId: "session-quest-multi-e2e",
            title: "Multi-Question Session",
          }),
        ],
      },
    })

    // question.asked with multiple questions
    await ingest({
      userId,
      payload: {
        events: [
          {
            event_id: "cc000002-cccc-4ccc-8ccc-cccccccccccc",
            adapter: "opencode",
            adapter_version: "1.0.0",
            device_uid: deviceUid,
            event_type: "question.asked",
            session_id: "session-quest-multi-e2e",
            occurred_at: "2026-02-22T10:30:00.000Z",
            payload: {
              id: "quest-multi-e2e",
              sessionID: "session-quest-multi-e2e",
              questions: [
                {
                  header: "Test Scope",
                  question: "Which tests?",
                  options: [
                    { label: "Unit", description: "Run unit tests only" },
                    { label: "All", description: "Run all test suites" },
                  ],
                  multiple: false,
                  custom: false,
                },
                {
                  header: "Coverage",
                  question: "Generate coverage report?",
                  options: [
                    { label: "Yes", description: "Generate coverage" },
                    { label: "No", description: "Skip coverage" },
                  ],
                  multiple: false,
                  custom: false,
                },
              ],
            },
          },
        ],
      },
    })

    expect(stores.requests.get("quest-multi-e2e")?.kind).toBe("question")

    const pluginClient = ioc(`http://127.0.0.1:${port}/plugin`, {
      transports: ["websocket"],
      auth: { token: validPat, device_uid: deviceUid },
    })

    const pluginReceivedAnswers: string[][][] = []

    pluginClient.on(
      "action.question.reply",
      async (
        envelope: PluginCommandEnvelope<{ answers: string[][] }>,
        ack: (r: PluginAckEnvelope) => void,
      ) => {
        pluginReceivedAnswers.push(envelope.payload.answers)
        ack({ command_id: envelope.command_id, accepted: true, error: null })

        // Plugin ingests question.replied with answers for both questions
        await ingest({
          userId,
          payload: {
            events: [
              questionRepliedEvent("cc000003-cccc-4ccc-8ccc-cccccccccccc", {
                deviceUid,
                requestId: "quest-multi-e2e",
                sessionId: "session-quest-multi-e2e",
                answers: envelope.payload.answers,
              }),
            ],
          },
        })
      },
    )

    await new Promise<void>((resolve, reject) => {
      pluginClient.on("connect", resolve)
      pluginClient.on("connect_error", reject)
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    try {
      const relay = createSocketRelay(io)
      const respondService = createRequestRespondService(stores.respondStore, relay)

      const result = await respondService({
        userId,
        requestId: "quest-multi-e2e",
        payload: {
          type: "question",
          answers: [["All"], ["Yes"]],
          client_action_id: "cc000004-cccc-4ccc-8ccc-cccccccccccc",
        },
      })

      expect(result.status).toBe("accepted")

      // Plugin received both answers
      expect(pluginReceivedAnswers).toHaveLength(1)
      expect(pluginReceivedAnswers[0]).toEqual([["All"], ["Yes"]])

      await new Promise<void>((resolve) => setTimeout(resolve, 100))

      // Request resolved
      expect(stores.requests.get("quest-multi-e2e")?.status).toBe("resolved")

      // Badge decremented
      const afterResolved = await sessionsOpen({ userId })
      expect(afterResolved.groups[0].sessions[0].requires_attention).toBe(false)
      expect(afterResolved.groups[0].sessions[0].attention_count).toBe(0)
    } finally {
      pluginClient.disconnect()
    }
  })
})

// ---------------------------------------------------------------------------
// 8. E2E: Offline fail-fast
// ---------------------------------------------------------------------------
//
// Scenario:
//   1. session.created + permission.asked arrive via ingest → request is open
//   2. No plugin socket is connected for the device
//   3. App sends respond action → relay detects no socket → PLUGIN_OFFLINE
//   4. Request remains open (status is still "open")
//   5. Badge count unchanged
//
//   Variant: plugin connects, then disconnects — action after disconnect also returns PLUGIN_OFFLINE

describe("E2E: offline fail-fast", () => {
  let io: Server
  let port: number
  let closeServer: () => Promise<void>
  const validPat = "pat_e2eoffline_testSecret"
  const userId = "user-offline-e2e"
  const deviceUid = "dev-offline-uid"

  beforeEach(async () => {
    io = new Server({ transports: ["websocket"] })
    configurePluginNamespace(io, {
      authenticate: async (token) => {
        if (token !== validPat) throw new ApiHttpError("UNAUTHORIZED")
        return { userId, patId: "pat-offline-e2e", tokenPrefix: "e2eoffline" }
      },
      getOrCreateDeviceId: async () => `device:${userId}:${deviceUid}`,
    })
    const server = await startTestServer(io)
    port = server.port
    closeServer = server.close
  })

  afterEach(async () => {
    await closeServer()
  })

  /**
   * Creates a relay that mirrors the production createPluginRelay's online check:
   * - fetchSockets() to confirm at least one socket is in the device room
   * - throw PLUGIN_OFFLINE if none found
   * - otherwise emit command and wait for ack
   */
  function createOnlineCheckingRelay(
    ioServer: Server,
    timeoutMs = 3000,
  ): (args: {
    deviceId: string
    envelope: PluginCommandEnvelope
    eventType: "action.permission.reply" | "action.question.reply" | "action.question.reject"
  }) => Promise<PluginAckEnvelope> {
    return async (args) => {
      const pluginNs = ioServer.of("/plugin")
      const room = `device:${args.deviceId}`

      // Check if there's at least one socket in the device room (mirrors production behavior)
      const sockets = await pluginNs.in(room).fetchSockets()
      if (sockets.length === 0) {
        throw new ApiHttpError("PLUGIN_OFFLINE")
      }

      return new Promise<PluginAckEnvelope>((resolve, reject) => {
        pluginNs
          .to(room)
          .timeout(timeoutMs)
          .emit(args.eventType, args.envelope, (err: Error | null, acks: PluginAckEnvelope[]) => {
            if (err || !acks || acks.length === 0) {
              reject(new ApiHttpError("RELAY_TIMEOUT"))
            } else {
              resolve(acks[0])
            }
          })
      })
    }
  }

  it("permission action when plugin is never connected returns PLUGIN_OFFLINE, request stays open", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)

    // Step 1: session.created + permission.asked via ingest
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("cc000001-cccc-4ccc-8ccc-cccccccccccc", {
            deviceUid,
            sessionId: "session-offline-perm",
            title: "Offline Fail-fast Session",
          }),
        ],
      },
    })

    await ingest({
      userId,
      payload: {
        events: [
          permissionAskedEvent("cc000002-cccc-4ccc-8ccc-cccccccccccc", {
            deviceUid,
            requestId: "perm-offline-e2e",
            sessionId: "session-offline-perm",
          }),
        ],
      },
    })

    // Verify: request is open, badge=1
    expect(stores.requests.get("perm-offline-e2e")?.status).toBe("open")
    const before = await sessionsOpen({ userId })
    expect(before.groups[0].sessions[0].requires_attention).toBe(true)
    expect(before.groups[0].sessions[0].attention_count).toBe(1)

    // Step 2: Attempt to respond — no plugin socket connected
    const relay = createOnlineCheckingRelay(io)
    const respondService = createRequestRespondService(stores.respondStore, relay)

    await expect(
      respondService({
        userId,
        requestId: "perm-offline-e2e",
        payload: {
          type: "permission",
          decision: "once",
          client_action_id: "cc000003-cccc-4ccc-8ccc-cccccccccccc",
        },
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_OFFLINE" })

    // Step 3: Request must still be open
    expect(stores.requests.get("perm-offline-e2e")?.status).toBe("open")

    // Badge and attention flag unchanged
    const after = await sessionsOpen({ userId })
    expect(after.groups[0].sessions[0].requires_attention).toBe(true)
    expect(after.groups[0].sessions[0].attention_count).toBe(1)

    // Action attempt saved as failed with PLUGIN_OFFLINE code
    const savedAttempt = stores.actionAttempts.get(`${userId}:cc000003-cccc-4ccc-8ccc-cccccccccccc`)
    expect(savedAttempt?.status).toBe("failed")
    expect(savedAttempt?.errorCode).toBe("PLUGIN_OFFLINE")
  })

  it("question action when plugin is never connected returns PLUGIN_OFFLINE, request stays open", async () => {
    const stores = createOrderingStores()
    const { ingest } = createFullOrderingServices(stores)

    // session.created + question.asked via ingest
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("dd000001-dddd-4ddd-8ddd-dddddddddddd", {
            deviceUid,
            sessionId: "session-offline-quest",
            title: "Offline Question Session",
          }),
          questionAskedEvent("dd000002-dddd-4ddd-8ddd-dddddddddddd", {
            deviceUid,
            requestId: "quest-offline-e2e",
            sessionId: "session-offline-quest",
          }),
        ],
      },
    })

    expect(stores.requests.get("quest-offline-e2e")?.status).toBe("open")

    const relay = createOnlineCheckingRelay(io)
    const respondService = createRequestRespondService(stores.respondStore, relay)

    await expect(
      respondService({
        userId,
        requestId: "quest-offline-e2e",
        payload: {
          type: "question",
          answers: [["All"]],
          client_action_id: "dd000003-dddd-4ddd-8ddd-dddddddddddd",
        },
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_OFFLINE" })

    // Request remains open
    expect(stores.requests.get("quest-offline-e2e")?.status).toBe("open")

    // Action attempt saved as failed
    const savedAttempt = stores.actionAttempts.get(`${userId}:dd000003-dddd-4ddd-8ddd-dddddddddddd`)
    expect(savedAttempt?.status).toBe("failed")
    expect(savedAttempt?.errorCode).toBe("PLUGIN_OFFLINE")
  })

  it("action after plugin disconnects returns PLUGIN_OFFLINE, request stays open", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)

    // Step 1: session.created + permission.asked via ingest
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("ee000001-eeee-4eee-8eee-eeeeeeeeeeee", {
            deviceUid,
            sessionId: "session-disconnect-perm",
            title: "Disconnect Test Session",
          }),
        ],
      },
    })

    await ingest({
      userId,
      payload: {
        events: [
          permissionAskedEvent("ee000002-eeee-4eee-8eee-eeeeeeeeeeee", {
            deviceUid,
            requestId: "perm-disconnect-e2e",
            sessionId: "session-disconnect-perm",
          }),
        ],
      },
    })

    // Step 2: Connect plugin, then disconnect it
    const pluginClient = ioc(`http://127.0.0.1:${port}/plugin`, {
      transports: ["websocket"],
      auth: { token: validPat, device_uid: deviceUid },
    })

    await new Promise<void>((resolve, reject) => {
      pluginClient.on("connect", resolve)
      pluginClient.on("connect_error", reject)
    })
    // Wait for room join to propagate
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    // Disconnect the plugin
    pluginClient.disconnect()
    // Wait for server to process disconnect
    await new Promise<void>((resolve) => setTimeout(resolve, 200))

    // Step 3: Attempt to respond — plugin is now offline
    const relay = createOnlineCheckingRelay(io)
    const respondService = createRequestRespondService(stores.respondStore, relay)

    await expect(
      respondService({
        userId,
        requestId: "perm-disconnect-e2e",
        payload: {
          type: "permission",
          decision: "reject",
          client_action_id: "ee000003-eeee-4eee-8eee-eeeeeeeeeeee",
        },
      }),
    ).rejects.toMatchObject({ code: "PLUGIN_OFFLINE" })

    // Request must still be open (not closed)
    expect(stores.requests.get("perm-disconnect-e2e")?.status).toBe("open")

    // Badge and attention flag unchanged
    const after = await sessionsOpen({ userId })
    expect(after.groups[0].sessions[0].requires_attention).toBe(true)
    expect(after.groups[0].sessions[0].attention_count).toBe(1)
  })
})

describe("E2E: multi-device ordering", () => {
  it("blocker on lower-ranked device moves its device group to the top", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)
    const userId = "user-e2e"

    // Device A: more recent last event (should start ranked first)
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("11111111-1111-4111-8111-111111111111", {
            deviceUid: "dev-A",
            sessionId: "session-A",
            title: "Device A Session",
          }),
        ],
      },
    })

    // Give device A a more recent lastEventAt by patching via a status event
    await ingest({
      userId,
      payload: {
        events: [
          {
            event_id: "22222222-2222-4222-8222-222222222222",
            adapter: "opencode",
            adapter_version: "1.0.0",
            device_uid: "dev-A",
            event_type: "session.status",
            session_id: "session-A",
            occurred_at: "2026-02-22T10:05:00.000Z",
            payload: { sessionID: "session-A", status: { type: "busy" } },
          },
        ],
      },
    })

    // Device B: older last event (should start ranked second)
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("33333333-3333-4333-8333-333333333333", {
            deviceUid: "dev-B",
            sessionId: "session-B",
            title: "Device B Session",
          }),
        ],
      },
    })

    // Manually set device B's session lastEventAt to be older than device A's
    const sessionB = stores.sessions.get("session-B")
    if (sessionB) {
      stores.sessions.set("session-B", {
        ...sessionB,
        lastEventAt: new Date("2026-02-22T09:00:00.000Z"),
      })
    }

    // Initial ordering check: device A should be first (more recent activity)
    const initialResult = await sessionsOpen({ userId })
    expect(initialResult.groups).toHaveLength(2)
    const deviceAId = `device:${userId}:dev-A`
    const deviceBId = `device:${userId}:dev-B`
    expect(initialResult.groups[0].device.id).toBe(deviceAId)
    expect(initialResult.groups[1].device.id).toBe(deviceBId)

    // Now send a permission.asked blocker to device B (the lower-ranked device)
    await ingest({
      userId,
      payload: {
        events: [
          permissionAskedEvent("44444444-4444-4444-8444-444444444444", {
            deviceUid: "dev-B",
            requestId: "perm-device-B",
            sessionId: "session-B",
          }),
        ],
      },
    })

    // After blocker: device B should now be ranked first because requires_attention=true
    const afterBlockerResult = await sessionsOpen({ userId })
    expect(afterBlockerResult.groups).toHaveLength(2)
    expect(afterBlockerResult.groups[0].device.id).toBe(deviceBId)
    expect(afterBlockerResult.groups[0].sessions[0].requires_attention).toBe(true)
    expect(afterBlockerResult.groups[0].sessions[0].attention_count).toBe(1)
    expect(afterBlockerResult.groups[1].device.id).toBe(deviceAId)
    expect(afterBlockerResult.groups[1].sessions[0].requires_attention).toBe(false)
  })

  it("multiple sessions on lower-ranked device — blocker on any session moves device group to top", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)
    const userId = "user-e2e-multi"

    // Device A: single active session (starts first due to recency)
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("11111111-1111-4111-8111-111111111111", {
            deviceUid: "dev-A",
            sessionId: "session-A1",
            title: "Device A Main Session",
          }),
        ],
      },
    })

    // Device B: two sessions, both older
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("22222222-2222-4222-8222-222222222222", {
            deviceUid: "dev-B",
            sessionId: "session-B1",
            title: "Device B Session 1",
          }),
          sessionCreatedEvent("33333333-3333-4333-8333-333333333333", {
            deviceUid: "dev-B",
            sessionId: "session-B2",
            title: "Device B Session 2",
          }),
        ],
      },
    })

    // Make device B's sessions older
    for (const sessionId of ["session-B1", "session-B2"]) {
      const session = stores.sessions.get(sessionId)
      if (session) {
        stores.sessions.set(sessionId, {
          ...session,
          lastEventAt: new Date("2026-02-22T08:00:00.000Z"),
        })
      }
    }

    // Initial: device A first, device B second
    const initial = await sessionsOpen({ userId })
    const deviceAId = `device:${userId}:dev-A`
    const deviceBId = `device:${userId}:dev-B`
    expect(initial.groups[0].device.id).toBe(deviceAId)
    expect(initial.groups[1].device.id).toBe(deviceBId)

    // Blocker on session-B2 (the second session on device B)
    await ingest({
      userId,
      payload: {
        events: [
          questionAskedEvent("44444444-4444-4444-8444-444444444444", {
            deviceUid: "dev-B",
            requestId: "question-B2",
            sessionId: "session-B2",
          }),
        ],
      },
    })

    // Device B should now be first
    const afterBlocker = await sessionsOpen({ userId })
    expect(afterBlocker.groups[0].device.id).toBe(deviceBId)
    // The session with the blocker should be first within device B's group
    expect(afterBlocker.groups[0].sessions[0].session_id).toBe("session-B2")
    expect(afterBlocker.groups[0].sessions[0].requires_attention).toBe(true)
    expect(afterBlocker.groups[1].device.id).toBe(deviceAId)
  })

  it("resolving the blocker restores original ordering", async () => {
    const stores = createOrderingStores()
    const { ingest, sessionsOpen } = createFullOrderingServices(stores)
    const userId = "user-e2e-restore"

    // Device A: more recent session (starts first)
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("11111111-1111-4111-8111-111111111111", {
            deviceUid: "dev-A",
            sessionId: "session-A",
            title: "Device A Session",
          }),
        ],
      },
    })

    // Device B: older session
    await ingest({
      userId,
      payload: {
        events: [
          sessionCreatedEvent("22222222-2222-4222-8222-222222222222", {
            deviceUid: "dev-B",
            sessionId: "session-B",
            title: "Device B Session",
          }),
        ],
      },
    })

    // Make device B's session older
    const sessionB = stores.sessions.get("session-B")
    if (sessionB) {
      stores.sessions.set("session-B", {
        ...sessionB,
        lastEventAt: new Date("2026-02-22T09:00:00.000Z"),
      })
    }

    // Add blocker to device B — it moves to top
    await ingest({
      userId,
      payload: {
        events: [
          permissionAskedEvent("33333333-3333-4333-8333-333333333333", {
            deviceUid: "dev-B",
            requestId: "perm-restore",
            sessionId: "session-B",
          }),
        ],
      },
    })

    const deviceAId = `device:${userId}:dev-A`
    const deviceBId = `device:${userId}:dev-B`

    const withBlocker = await sessionsOpen({ userId })
    expect(withBlocker.groups[0].device.id).toBe(deviceBId)

    // Resolve the blocker via permission.replied
    await ingest({
      userId,
      payload: {
        events: [
          permissionRepliedEvent("44444444-4444-4444-8444-444444444444", {
            deviceUid: "dev-B",
            requestId: "perm-restore",
            sessionId: "session-B",
            reply: "once",
          }),
        ],
      },
    })

    // After resolution, device B no longer requires attention
    // Device A should be ranked first again (more recent lastEventAt)
    const afterResolved = await sessionsOpen({ userId })
    expect(afterResolved.groups[0].sessions[0].requires_attention).toBe(false)
    expect(afterResolved.groups[1].sessions[0].requires_attention).toBe(false)
    // device A should be first again
    expect(afterResolved.groups[0].device.id).toBe(deviceAId)
    expect(afterResolved.groups[1].device.id).toBe(deviceBId)
  })
})
