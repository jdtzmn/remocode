import { describe, expect, it } from "vitest"

import {
  ApiErrorCodeSchema,
  ApiErrorSchema,
  CanonicalEventSchema,
  DeviceActivityPayloadSchema,
  EventTypeSchema,
  PatCreateRequestSchema,
  PatCreateResponseSchema,
  PatListItemSchema,
  PatListResponseSchema,
  PermissionRepliedPayloadSchema,
  PermissionRequestPayloadSchema,
  PermissionRespondRequestSchema,
  PluginCommandAckSchema,
  PluginCommandSchema,
  PluginConnectedPayloadSchema,
  PluginEventsIngestRequestSchema,
  PluginEventsIngestResponseSchema,
  PluginHeartbeatPayloadSchema,
  PluginHeartbeatRequestSchema,
  QuestionRejectedPayloadSchema,
  QuestionRepliedPayloadSchema,
  QuestionRequestPayloadSchema,
  QuestionRespondAnswersRequestSchema,
  QuestionRespondRejectRequestSchema,
  RequestRespondRequestSchema,
  SessionInfoSchema,
  SessionLifecyclePayloadSchema,
  SessionStatusPayloadSchema,
  SessionStatusSchema,
  SessionsOpenResponseSchema,
} from "./index"

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

const VALID_UUID = "11111111-1111-4111-8111-111111111111"
const VALID_ISO = "2026-02-22T10:30:00.000Z"

const BASE_EVENT = {
  event_id: VALID_UUID,
  adapter: "opencode",
  adapter_version: "1.0.0",
  device_uid: "device-uid-1",
  occurred_at: VALID_ISO,
}

const SESSION_INFO = {
  id: "session-abc",
  title: "Refactor auth",
  directory: "/Users/foo/repo",
  projectID: "proj-1",
  version: "1",
  time: { created: 1708559400000, updated: 1708559440000 },
}

// ────────────────────────────────────────────────────────────
// EventTypeSchema
// ────────────────────────────────────────────────────────────

describe("EventTypeSchema", () => {
  it("accepts all 12 canonical event types", () => {
    const types = [
      "plugin.connected",
      "plugin.heartbeat",
      "device.activity",
      "session.created",
      "session.updated",
      "session.deleted",
      "session.status",
      "permission.asked",
      "permission.replied",
      "question.asked",
      "question.replied",
      "question.rejected",
    ]
    for (const t of types) {
      expect(EventTypeSchema.safeParse(t).success).toBe(true)
    }
  })

  it("rejects unknown event types", () => {
    expect(EventTypeSchema.safeParse("file.edited").success).toBe(false)
    expect(EventTypeSchema.safeParse("").success).toBe(false)
    expect(EventTypeSchema.safeParse("session.idle").success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// SessionStatusSchema
// ────────────────────────────────────────────────────────────

describe("SessionStatusSchema", () => {
  it("accepts idle status", () => {
    expect(SessionStatusSchema.safeParse({ type: "idle" }).success).toBe(true)
  })

  it("accepts busy status", () => {
    expect(SessionStatusSchema.safeParse({ type: "busy" }).success).toBe(true)
  })

  it("accepts retry status with all required fields", () => {
    expect(
      SessionStatusSchema.safeParse({
        type: "retry",
        attempt: 2,
        message: "rate limited",
        next: 1708559500000,
      }).success,
    ).toBe(true)
  })

  it("rejects retry status with missing fields", () => {
    // missing message and next
    expect(SessionStatusSchema.safeParse({ type: "retry", attempt: 1 }).success).toBe(false)
  })

  it("rejects unknown status type", () => {
    expect(SessionStatusSchema.safeParse({ type: "unknown" }).success).toBe(false)
  })

  it("rejects extra fields on idle (strict)", () => {
    expect(SessionStatusSchema.safeParse({ type: "idle", extra: true }).success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// SessionInfoSchema
// ────────────────────────────────────────────────────────────

describe("SessionInfoSchema", () => {
  it("accepts a minimal valid session info", () => {
    expect(SessionInfoSchema.safeParse(SESSION_INFO).success).toBe(true)
  })

  it("accepts session info with optional fields", () => {
    const full = {
      ...SESSION_INFO,
      slug: "refactor-auth",
      parentID: "parent-1",
      summary: { additions: 10, deletions: 5, files: 3 },
      share: { url: "https://example.com/share/1" },
    }
    expect(SessionInfoSchema.safeParse(full).success).toBe(true)
  })

  it("rejects missing required fields", () => {
    const { title: _title, ...noTitle } = SESSION_INFO
    expect(SessionInfoSchema.safeParse(noTitle).success).toBe(false)

    const { directory: _dir, ...noDir } = SESSION_INFO
    expect(SessionInfoSchema.safeParse(noDir).success).toBe(false)
  })

  it("rejects extra fields (strict)", () => {
    expect(SessionInfoSchema.safeParse({ ...SESSION_INFO, unknownField: true }).success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// PermissionRequestPayloadSchema
// ────────────────────────────────────────────────────────────

describe("PermissionRequestPayloadSchema", () => {
  const VALID_PERM = {
    id: "perm-01",
    sessionID: "session-abc",
    permission: "bash",
    patterns: ["npm install"],
    metadata: { cwd: "/repo" },
    always: [],
  }

  it("accepts a valid permission request payload", () => {
    expect(PermissionRequestPayloadSchema.safeParse(VALID_PERM).success).toBe(true)
  })

  it("accepts permission with optional tool field", () => {
    expect(
      PermissionRequestPayloadSchema.safeParse({
        ...VALID_PERM,
        tool: { messageID: "msg-1", callID: "call-1" },
      }).success,
    ).toBe(true)
  })

  it("rejects missing required fields", () => {
    const { id: _id, ...noId } = VALID_PERM
    expect(PermissionRequestPayloadSchema.safeParse(noId).success).toBe(false)
  })

  it("rejects extra fields (strict)", () => {
    expect(
      PermissionRequestPayloadSchema.safeParse({ ...VALID_PERM, extra: "field" }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// PermissionRepliedPayloadSchema
// ────────────────────────────────────────────────────────────

describe("PermissionRepliedPayloadSchema", () => {
  it("accepts once reply", () => {
    expect(
      PermissionRepliedPayloadSchema.safeParse({
        sessionID: "session-abc",
        requestID: "perm-01",
        reply: "once",
      }).success,
    ).toBe(true)
  })

  it("accepts always reply", () => {
    expect(
      PermissionRepliedPayloadSchema.safeParse({
        sessionID: "session-abc",
        requestID: "perm-01",
        reply: "always",
      }).success,
    ).toBe(true)
  })

  it("accepts reject reply", () => {
    expect(
      PermissionRepliedPayloadSchema.safeParse({
        sessionID: "session-abc",
        requestID: "perm-01",
        reply: "reject",
      }).success,
    ).toBe(true)
  })

  it("rejects unknown reply value", () => {
    expect(
      PermissionRepliedPayloadSchema.safeParse({
        sessionID: "session-abc",
        requestID: "perm-01",
        reply: "deny",
      }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// QuestionRequestPayloadSchema
// ────────────────────────────────────────────────────────────

describe("QuestionRequestPayloadSchema", () => {
  const VALID_QUESTION = {
    id: "question-01",
    sessionID: "session-abc",
    questions: [
      {
        header: "Test Scope",
        question: "Which tests should I run?",
        options: [
          { label: "Unit", description: "Run unit tests only" },
          { label: "All", description: "Run all test suites" },
        ],
      },
    ],
  }

  it("accepts a valid question request payload", () => {
    expect(QuestionRequestPayloadSchema.safeParse(VALID_QUESTION).success).toBe(true)
  })

  it("accepts question with optional tool field", () => {
    expect(
      QuestionRequestPayloadSchema.safeParse({
        ...VALID_QUESTION,
        tool: { messageID: "msg-1", callID: "call-1" },
      }).success,
    ).toBe(true)
  })

  it("accepts question with multiple and custom options", () => {
    const withOpts = {
      ...VALID_QUESTION,
      questions: [
        {
          ...VALID_QUESTION.questions[0],
          multiple: true,
          custom: true,
        },
      ],
    }
    expect(QuestionRequestPayloadSchema.safeParse(withOpts).success).toBe(true)
  })

  it("rejects missing sessionID", () => {
    const { sessionID: _s, ...noSession } = VALID_QUESTION
    expect(QuestionRequestPayloadSchema.safeParse(noSession).success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// QuestionRepliedPayloadSchema
// ────────────────────────────────────────────────────────────

describe("QuestionRepliedPayloadSchema", () => {
  it("accepts valid question replied payload", () => {
    expect(
      QuestionRepliedPayloadSchema.safeParse({
        sessionID: "session-abc",
        requestID: "question-01",
        answers: [["All"]],
      }).success,
    ).toBe(true)
  })

  it("accepts multiple answer sets", () => {
    expect(
      QuestionRepliedPayloadSchema.safeParse({
        sessionID: "s",
        requestID: "q1",
        answers: [["opt1", "opt2"], ["opt3"]],
      }).success,
    ).toBe(true)
  })

  it("rejects missing answers field", () => {
    expect(
      QuestionRepliedPayloadSchema.safeParse({
        sessionID: "s",
        requestID: "q1",
      }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// QuestionRejectedPayloadSchema
// ────────────────────────────────────────────────────────────

describe("QuestionRejectedPayloadSchema", () => {
  it("accepts valid question rejected payload", () => {
    expect(
      QuestionRejectedPayloadSchema.safeParse({
        sessionID: "session-abc",
        requestID: "question-01",
      }).success,
    ).toBe(true)
  })

  it("rejects extra fields (strict)", () => {
    expect(
      QuestionRejectedPayloadSchema.safeParse({
        sessionID: "session-abc",
        requestID: "question-01",
        extra: "field",
      }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// PluginConnectedPayloadSchema
// ────────────────────────────────────────────────────────────

describe("PluginConnectedPayloadSchema", () => {
  it("accepts valid plugin connected payload", () => {
    expect(
      PluginConnectedPayloadSchema.safeParse({
        plugin_version: "1.0.0",
        opencode_version: "2.0.0",
        platform: "darwin",
        hostname: "mbp-jacob",
        capabilities: {
          activity: true,
          unblock_permission: true,
          unblock_question: true,
        },
      }).success,
    ).toBe(true)
  })

  it("rejects missing hostname", () => {
    expect(
      PluginConnectedPayloadSchema.safeParse({
        plugin_version: "1.0.0",
        opencode_version: "2.0.0",
        platform: "darwin",
        capabilities: {
          activity: true,
          unblock_permission: true,
          unblock_question: true,
        },
      }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// PluginHeartbeatPayloadSchema
// ────────────────────────────────────────────────────────────

describe("PluginHeartbeatPayloadSchema", () => {
  it("accepts valid heartbeat payload", () => {
    expect(
      PluginHeartbeatPayloadSchema.safeParse({
        uptime_sec: 174,
        active_session_ids: ["session-1", "session-2"],
        queue_depth: 0,
      }).success,
    ).toBe(true)
  })

  it("accepts empty active_session_ids", () => {
    expect(
      PluginHeartbeatPayloadSchema.safeParse({
        uptime_sec: 0,
        active_session_ids: [],
        queue_depth: 0,
      }).success,
    ).toBe(true)
  })

  it("rejects negative uptime", () => {
    expect(
      PluginHeartbeatPayloadSchema.safeParse({
        uptime_sec: -1,
        active_session_ids: [],
        queue_depth: 0,
      }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// DeviceActivityPayloadSchema
// ────────────────────────────────────────────────────────────

describe("DeviceActivityPayloadSchema", () => {
  it("accepts fully populated activity payload", () => {
    expect(
      DeviceActivityPayloadSchema.safeParse({
        is_active: true,
        idle_seconds: 24,
        frontmost_app: "iTerm2",
        terminal_frontmost: true,
        sampled_at: VALID_ISO,
        confidence: "high",
      }).success,
    ).toBe(true)
  })

  it("accepts null values for nullable fields", () => {
    expect(
      DeviceActivityPayloadSchema.safeParse({
        is_active: null,
        idle_seconds: null,
        frontmost_app: null,
        terminal_frontmost: null,
        sampled_at: VALID_ISO,
        confidence: "unknown",
      }).success,
    ).toBe(true)
  })

  it("accepts all confidence levels", () => {
    for (const confidence of ["high", "medium", "low", "unknown"]) {
      expect(
        DeviceActivityPayloadSchema.safeParse({
          is_active: true,
          idle_seconds: 0,
          frontmost_app: null,
          terminal_frontmost: null,
          sampled_at: VALID_ISO,
          confidence,
        }).success,
      ).toBe(true)
    }
  })

  it("rejects invalid confidence level", () => {
    expect(
      DeviceActivityPayloadSchema.safeParse({
        is_active: true,
        idle_seconds: 0,
        frontmost_app: null,
        terminal_frontmost: null,
        sampled_at: VALID_ISO,
        confidence: "very-high",
      }).success,
    ).toBe(false)
  })

  it("rejects invalid sampled_at format", () => {
    expect(
      DeviceActivityPayloadSchema.safeParse({
        is_active: true,
        idle_seconds: 0,
        frontmost_app: null,
        terminal_frontmost: null,
        sampled_at: "not-a-date",
        confidence: "high",
      }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// SessionLifecyclePayloadSchema
// ────────────────────────────────────────────────────────────

describe("SessionLifecyclePayloadSchema", () => {
  it("accepts valid lifecycle payload", () => {
    expect(SessionLifecyclePayloadSchema.safeParse({ info: SESSION_INFO }).success).toBe(true)
  })

  it("rejects missing info field", () => {
    expect(SessionLifecyclePayloadSchema.safeParse({}).success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// SessionStatusPayloadSchema
// ────────────────────────────────────────────────────────────

describe("SessionStatusPayloadSchema", () => {
  it("accepts valid session status payload", () => {
    expect(
      SessionStatusPayloadSchema.safeParse({
        sessionID: "session-abc",
        status: { type: "idle" },
      }).success,
    ).toBe(true)
  })

  it("rejects invalid status type", () => {
    expect(
      SessionStatusPayloadSchema.safeParse({
        sessionID: "session-abc",
        status: { type: "unknown" },
      }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// CanonicalEventSchema — discriminated union
// ────────────────────────────────────────────────────────────

describe("CanonicalEventSchema", () => {
  it("accepts plugin.connected event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "plugin.connected",
        payload: {
          plugin_version: "1.0.0",
          opencode_version: "2.0.0",
          platform: "darwin",
          hostname: "mbp-jacob",
          capabilities: {
            activity: true,
            unblock_permission: true,
            unblock_question: true,
          },
        },
      }).success,
    ).toBe(true)
  })

  it("accepts plugin.heartbeat event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "plugin.heartbeat",
        payload: {
          uptime_sec: 60,
          active_session_ids: ["s1"],
          queue_depth: 0,
        },
      }).success,
    ).toBe(true)
  })

  it("accepts device.activity event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "device.activity",
        payload: {
          is_active: true,
          idle_seconds: 5,
          frontmost_app: "Terminal",
          terminal_frontmost: true,
          sampled_at: VALID_ISO,
          confidence: "high",
        },
      }).success,
    ).toBe(true)
  })

  it("accepts session.created event with session_id", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "session.created",
        session_id: "session-abc",
        payload: { info: SESSION_INFO },
      }).success,
    ).toBe(true)
  })

  it("accepts session.updated event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "session.updated",
        session_id: "session-abc",
        payload: { info: { ...SESSION_INFO, title: "Updated title" } },
      }).success,
    ).toBe(true)
  })

  it("accepts session.deleted event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "session.deleted",
        session_id: "session-abc",
        payload: { info: SESSION_INFO },
      }).success,
    ).toBe(true)
  })

  it("accepts session.status event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "session.status",
        session_id: "session-abc",
        payload: {
          sessionID: "session-abc",
          status: { type: "busy" },
        },
      }).success,
    ).toBe(true)
  })

  it("accepts permission.asked event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "permission.asked",
        session_id: "session-abc",
        payload: {
          id: "perm-01",
          sessionID: "session-abc",
          permission: "bash",
          patterns: ["npm install"],
          metadata: {},
          always: [],
        },
      }).success,
    ).toBe(true)
  })

  it("accepts permission.replied event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "permission.replied",
        session_id: "session-abc",
        payload: {
          sessionID: "session-abc",
          requestID: "perm-01",
          reply: "once",
        },
      }).success,
    ).toBe(true)
  })

  it("accepts question.asked event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "question.asked",
        session_id: "session-abc",
        payload: {
          id: "question-01",
          sessionID: "session-abc",
          questions: [
            {
              header: "Test Scope",
              question: "Which tests should I run?",
              options: [{ label: "Unit", description: "Run unit tests only" }],
            },
          ],
        },
      }).success,
    ).toBe(true)
  })

  it("accepts question.replied event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "question.replied",
        session_id: "session-abc",
        payload: {
          sessionID: "session-abc",
          requestID: "question-01",
          answers: [["All"]],
        },
      }).success,
    ).toBe(true)
  })

  it("accepts question.rejected event", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "question.rejected",
        session_id: "session-abc",
        payload: {
          sessionID: "session-abc",
          requestID: "question-01",
        },
      }).success,
    ).toBe(true)
  })

  it("rejects event with missing required base fields", () => {
    // Missing event_id
    expect(
      CanonicalEventSchema.safeParse({
        adapter: "opencode",
        adapter_version: "1.0.0",
        device_uid: "device-1",
        occurred_at: VALID_ISO,
        event_type: "plugin.heartbeat",
        payload: { uptime_sec: 0, active_session_ids: [], queue_depth: 0 },
      }).success,
    ).toBe(false)
  })

  it("rejects event with non-UUID event_id", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_id: "not-a-uuid",
        event_type: "plugin.heartbeat",
        payload: { uptime_sec: 0, active_session_ids: [], queue_depth: 0 },
      }).success,
    ).toBe(false)
  })

  it("rejects event with non-ISO occurred_at", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        occurred_at: "2026-02-22",
        event_type: "plugin.heartbeat",
        payload: { uptime_sec: 0, active_session_ids: [], queue_depth: 0 },
      }).success,
    ).toBe(false)
  })

  it("rejects session.created without session_id", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "session.created",
        // no session_id
        payload: { info: SESSION_INFO },
      }).success,
    ).toBe(false)
  })

  it("rejects unknown event_type", () => {
    expect(
      CanonicalEventSchema.safeParse({
        ...BASE_EVENT,
        event_type: "file.edited",
        payload: {},
      }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// PluginEventsIngestRequestSchema
// ────────────────────────────────────────────────────────────

describe("PluginEventsIngestRequestSchema", () => {
  const validEvent = {
    ...BASE_EVENT,
    event_type: "plugin.heartbeat",
    payload: { uptime_sec: 10, active_session_ids: [], queue_depth: 0 },
  }

  it("accepts valid ingest request with one event", () => {
    expect(PluginEventsIngestRequestSchema.safeParse({ events: [validEvent] }).success).toBe(true)
  })

  it("rejects empty events array", () => {
    expect(PluginEventsIngestRequestSchema.safeParse({ events: [] }).success).toBe(false)
  })

  it("rejects more than 500 events", () => {
    const events = Array.from({ length: 501 }, (_, i) => ({
      ...validEvent,
      event_id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
    }))
    expect(PluginEventsIngestRequestSchema.safeParse({ events }).success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// PluginEventsIngestResponseSchema
// ────────────────────────────────────────────────────────────

describe("PluginEventsIngestResponseSchema", () => {
  it("accepts valid ingest response", () => {
    expect(
      PluginEventsIngestResponseSchema.safeParse({
        accepted: 1,
        deduped: 0,
        errors: [],
      }).success,
    ).toBe(true)
  })

  it("accepts response with errors", () => {
    expect(
      PluginEventsIngestResponseSchema.safeParse({
        accepted: 0,
        deduped: 0,
        errors: [{ event_id: VALID_UUID, code: "INVALID_PAYLOAD", message: "bad" }],
      }).success,
    ).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// PluginHeartbeatRequestSchema
// ────────────────────────────────────────────────────────────

describe("PluginHeartbeatRequestSchema", () => {
  it("accepts valid heartbeat request", () => {
    expect(
      PluginHeartbeatRequestSchema.safeParse({
        device_uid: "dev-uid-1",
        plugin_version: "1.0.0",
        uptime_sec: 60,
        active_session_ids: [],
        sent_at: VALID_ISO,
      }).success,
    ).toBe(true)
  })

  it("applies default empty array for active_session_ids", () => {
    const result = PluginHeartbeatRequestSchema.safeParse({
      device_uid: "dev-uid-1",
      plugin_version: "1.0.0",
      uptime_sec: 60,
      sent_at: VALID_ISO,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.active_session_ids).toEqual([])
    }
  })
})

// ────────────────────────────────────────────────────────────
// RequestRespondRequestSchema (permission + question variants)
// ────────────────────────────────────────────────────────────

describe("RequestRespondRequestSchema", () => {
  it("accepts permission response with decision=once", () => {
    expect(
      RequestRespondRequestSchema.safeParse({
        type: "permission",
        decision: "once",
        client_action_id: VALID_UUID,
      }).success,
    ).toBe(true)
  })

  it("accepts permission response with decision=always", () => {
    expect(
      RequestRespondRequestSchema.safeParse({
        type: "permission",
        decision: "always",
        client_action_id: VALID_UUID,
      }).success,
    ).toBe(true)
  })

  it("accepts permission response with decision=reject and optional message", () => {
    expect(
      RequestRespondRequestSchema.safeParse({
        type: "permission",
        decision: "reject",
        message: "Rejected because unsafe",
        client_action_id: VALID_UUID,
      }).success,
    ).toBe(true)
  })

  it("rejects permission response with message when decision is not reject", () => {
    expect(
      PermissionRespondRequestSchema.safeParse({
        type: "permission",
        decision: "once",
        message: "This should fail",
        client_action_id: VALID_UUID,
      }).success,
    ).toBe(false)
  })

  it("accepts question respond with answers", () => {
    expect(
      QuestionRespondAnswersRequestSchema.safeParse({
        type: "question",
        answers: [["All"]],
        client_action_id: VALID_UUID,
      }).success,
    ).toBe(true)
  })

  it("rejects question respond with empty answers", () => {
    expect(
      QuestionRespondAnswersRequestSchema.safeParse({
        type: "question",
        answers: [],
        client_action_id: VALID_UUID,
      }).success,
    ).toBe(false)
  })

  it("accepts question reject", () => {
    expect(
      QuestionRespondRejectRequestSchema.safeParse({
        type: "question",
        decision: "reject",
        client_action_id: VALID_UUID,
      }).success,
    ).toBe(true)
  })

  it("rejects question respond with invalid client_action_id", () => {
    expect(
      RequestRespondRequestSchema.safeParse({
        type: "question",
        decision: "reject",
        client_action_id: "not-a-uuid",
      }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// PAT schemas
// ────────────────────────────────────────────────────────────

describe("PatCreateRequestSchema", () => {
  it("accepts valid label", () => {
    expect(PatCreateRequestSchema.safeParse({ label: "work-mac" }).success).toBe(true)
  })

  it("rejects empty label", () => {
    expect(PatCreateRequestSchema.safeParse({ label: "" }).success).toBe(false)
  })

  it("rejects label over 120 chars", () => {
    expect(PatCreateRequestSchema.safeParse({ label: "a".repeat(121) }).success).toBe(false)
  })

  it("accepts label of exactly 120 chars", () => {
    expect(PatCreateRequestSchema.safeParse({ label: "a".repeat(120) }).success).toBe(true)
  })
})

describe("PatCreateResponseSchema", () => {
  it("accepts valid PAT create response", () => {
    expect(
      PatCreateResponseSchema.safeParse({
        id: "pat-1",
        label: "work-mac",
        token: "pat_abc123_secret",
        created_at: VALID_ISO,
      }).success,
    ).toBe(true)
  })
})

describe("PatListItemSchema", () => {
  it("accepts PAT list item with all fields", () => {
    expect(
      PatListItemSchema.safeParse({
        id: "pat-1",
        label: "work-mac",
        token_prefix: "abc123",
        created_at: VALID_ISO,
        last_used_at: VALID_ISO,
        revoked_at: null,
      }).success,
    ).toBe(true)
  })

  it("accepts PAT list item with null last_used_at", () => {
    expect(
      PatListItemSchema.safeParse({
        id: "pat-1",
        label: "work-mac",
        token_prefix: "abc123",
        created_at: VALID_ISO,
        last_used_at: null,
        revoked_at: null,
      }).success,
    ).toBe(true)
  })
})

describe("PatListResponseSchema", () => {
  it("accepts empty pats list", () => {
    expect(PatListResponseSchema.safeParse({ pats: [] }).success).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// Plugin command schemas
// ────────────────────────────────────────────────────────────

describe("PluginCommandSchema", () => {
  it("accepts action.permission.reply command", () => {
    expect(
      PluginCommandSchema.safeParse({
        command_id: VALID_UUID,
        type: "action.permission.reply",
        request_id: "perm-01",
        session_id: "session-abc",
        payload: { reply: "once" },
      }).success,
    ).toBe(true)
  })

  it("accepts action.permission.reply with optional message", () => {
    expect(
      PluginCommandSchema.safeParse({
        command_id: VALID_UUID,
        type: "action.permission.reply",
        request_id: "perm-01",
        session_id: "session-abc",
        payload: { reply: "reject", message: "Unsafe operation" },
      }).success,
    ).toBe(true)
  })

  it("accepts action.question.reply command", () => {
    expect(
      PluginCommandSchema.safeParse({
        command_id: VALID_UUID,
        type: "action.question.reply",
        request_id: "question-01",
        session_id: "session-abc",
        payload: { answers: [["All"]] },
      }).success,
    ).toBe(true)
  })

  it("rejects action.question.reply with empty answers", () => {
    expect(
      PluginCommandSchema.safeParse({
        command_id: VALID_UUID,
        type: "action.question.reply",
        request_id: "question-01",
        session_id: "session-abc",
        payload: { answers: [] },
      }).success,
    ).toBe(false)
  })

  it("accepts action.question.reject command", () => {
    expect(
      PluginCommandSchema.safeParse({
        command_id: VALID_UUID,
        type: "action.question.reject",
        request_id: "question-01",
        session_id: "session-abc",
        payload: {},
      }).success,
    ).toBe(true)
  })

  it("rejects command with invalid command_id UUID", () => {
    expect(
      PluginCommandSchema.safeParse({
        command_id: "not-a-uuid",
        type: "action.question.reject",
        request_id: "question-01",
        session_id: "session-abc",
        payload: {},
      }).success,
    ).toBe(false)
  })
})

describe("PluginCommandAckSchema", () => {
  it("accepts successful ack", () => {
    expect(
      PluginCommandAckSchema.safeParse({
        command_id: VALID_UUID,
        accepted: true,
        error: null,
      }).success,
    ).toBe(true)
  })

  it("accepts failed ack with error details", () => {
    expect(
      PluginCommandAckSchema.safeParse({
        command_id: VALID_UUID,
        accepted: false,
        error: { code: "EXECUTION_FAILED", message: "Command failed" },
      }).success,
    ).toBe(true)
  })

  it("rejects ack without command_id", () => {
    expect(
      PluginCommandAckSchema.safeParse({
        accepted: true,
        error: null,
      }).success,
    ).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// ApiErrorSchema
// ────────────────────────────────────────────────────────────

describe("ApiErrorSchema", () => {
  it("accepts all canonical error codes", () => {
    const codes = [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "INVALID_PAYLOAD",
      "INVALID_EVENT_TYPE",
      "EVENT_DUPLICATE",
      "REQUEST_NOT_FOUND",
      "REQUEST_ALREADY_CLOSED",
      "PLUGIN_OFFLINE",
      "RELAY_TIMEOUT",
      "RELAY_EXECUTION_FAILED",
      "INVALID_QUESTION_ANSWERS",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
    ]
    for (const code of codes) {
      expect(ApiErrorCodeSchema.safeParse(code).success).toBe(true)
    }
  })

  it("accepts valid API error response", () => {
    expect(
      ApiErrorSchema.safeParse({
        error: {
          code: "PLUGIN_OFFLINE",
          message: "Target device is offline",
          details: {},
        },
      }).success,
    ).toBe(true)
  })

  it("accepts API error with details", () => {
    expect(
      ApiErrorSchema.safeParse({
        error: {
          code: "INVALID_PAYLOAD",
          message: "Bad request",
          details: { field: "session_id", reason: "required" },
        },
      }).success,
    ).toBe(true)
  })

  it("rejects unknown error codes", () => {
    expect(ApiErrorCodeSchema.safeParse("CUSTOM_ERROR").success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────
// SessionsOpenResponseSchema
// ────────────────────────────────────────────────────────────

describe("SessionsOpenResponseSchema", () => {
  it("accepts valid sessions open response", () => {
    expect(
      SessionsOpenResponseSchema.safeParse({
        groups: [
          {
            device: {
              id: "dev-1",
              name: "MacBook Pro",
              platform: "darwin",
              last_seen_at: VALID_ISO,
              activity: {
                is_active: true,
                idle_seconds: 24,
                sampled_at: VALID_ISO,
              },
            },
            sessions: [
              {
                session_id: "session-abc",
                title: "Refactor auth",
                state: "busy",
                requires_attention: true,
                attention_count: 1,
                last_event_at: VALID_ISO,
                last_attention_at: VALID_ISO,
                is_stale: false,
              },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it("accepts response with null device activity", () => {
    expect(
      SessionsOpenResponseSchema.safeParse({
        groups: [
          {
            device: {
              id: "dev-1",
              name: null,
              platform: null,
              last_seen_at: null,
              activity: null,
            },
            sessions: [],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it("accepts empty groups", () => {
    expect(SessionsOpenResponseSchema.safeParse({ groups: [] }).success).toBe(true)
  })
})
