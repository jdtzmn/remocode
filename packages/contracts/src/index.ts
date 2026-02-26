import { z } from "zod"

export const IsoDateTimeSchema = z.string().datetime({ offset: true })
export const UuidSchema = z.string().uuid()

export const EventTypeSchema = z.enum([
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
])

export const SessionStatusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("idle") }).strict(),
  z.object({ type: z.literal("busy") }).strict(),
  z
    .object({
      type: z.literal("retry"),
      attempt: z.number().int().nonnegative(),
      message: z.string().min(1),
      next: z.number().int().nonnegative(),
    })
    .strict(),
])

export const PermissionReplySchema = z.enum(["once", "always", "reject"])

export const SessionInfoSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1).optional(),
    projectID: z.string().min(1),
    directory: z.string().min(1),
    parentID: z.string().min(1).optional(),
    summary: z
      .object({
        additions: z.number().int(),
        deletions: z.number().int(),
        files: z.number().int(),
        diffs: z.array(z.unknown()).optional(),
      })
      .strict()
      .optional(),
    share: z
      .object({
        url: z.string().url(),
      })
      .strict()
      .optional(),
    title: z.string().min(1),
    version: z.string().min(1),
    time: z
      .object({
        created: z.number().int().nonnegative(),
        updated: z.number().int().nonnegative(),
        compacting: z.number().int().nonnegative().optional(),
        archived: z.number().int().nonnegative().optional(),
      })
      .strict(),
    permission: z
      .array(
        z
          .object({
            permission: z.string().min(1),
            pattern: z.string().min(1),
            action: z.enum(["allow", "deny", "ask"]),
          })
          .strict(),
      )
      .optional(),
    revert: z
      .object({
        messageID: z.string().min(1),
        partID: z.string().min(1).optional(),
        snapshot: z.string().min(1).optional(),
        diff: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const QuestionOptionSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().min(1),
  })
  .strict()

export const QuestionInfoSchema = z
  .object({
    question: z.string().min(1),
    header: z.string().min(1).max(30),
    options: z.array(QuestionOptionSchema),
    multiple: z.boolean().optional(),
    custom: z.boolean().optional(),
  })
  .strict()

export const PermissionRequestPayloadSchema = z
  .object({
    id: z.string().min(1),
    sessionID: z.string().min(1),
    permission: z.string().min(1),
    patterns: z.array(z.string().min(1)),
    metadata: z.record(z.string(), z.unknown()),
    always: z.array(z.string().min(1)),
    tool: z
      .object({
        messageID: z.string().min(1),
        callID: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()

export const PermissionRepliedPayloadSchema = z
  .object({
    sessionID: z.string().min(1),
    requestID: z.string().min(1),
    reply: PermissionReplySchema,
  })
  .strict()

export const QuestionRequestPayloadSchema = z
  .object({
    id: z.string().min(1),
    sessionID: z.string().min(1),
    questions: z.array(QuestionInfoSchema),
    tool: z
      .object({
        messageID: z.string().min(1),
        callID: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()

export const QuestionRepliedPayloadSchema = z
  .object({
    sessionID: z.string().min(1),
    requestID: z.string().min(1),
    answers: z.array(z.array(z.string().min(1))),
  })
  .strict()

export const QuestionRejectedPayloadSchema = z
  .object({
    sessionID: z.string().min(1),
    requestID: z.string().min(1),
  })
  .strict()

export const PluginConnectedPayloadSchema = z
  .object({
    plugin_version: z.string().min(1),
    opencode_version: z.string().min(1),
    platform: z.string().min(1),
    hostname: z.string().min(1),
    capabilities: z
      .object({
        activity: z.boolean(),
        unblock_permission: z.boolean(),
        unblock_question: z.boolean(),
      })
      .strict(),
  })
  .strict()

export const PluginHeartbeatPayloadSchema = z
  .object({
    uptime_sec: z.number().int().nonnegative(),
    active_session_ids: z.array(z.string().min(1)),
    queue_depth: z.number().int().nonnegative(),
  })
  .strict()

export const ActivityConfidenceSchema = z.enum(["high", "medium", "low", "unknown"])

export const DeviceActivityPayloadSchema = z
  .object({
    is_active: z.boolean().nullable(),
    idle_seconds: z.number().int().nonnegative().nullable(),
    frontmost_app: z.string().min(1).nullable(),
    terminal_frontmost: z.boolean().nullable(),
    sampled_at: IsoDateTimeSchema,
    confidence: ActivityConfidenceSchema,
  })
  .strict()

export const SessionLifecyclePayloadSchema = z
  .object({
    info: SessionInfoSchema,
  })
  .strict()

export const SessionStatusPayloadSchema = z
  .object({
    sessionID: z.string().min(1),
    status: SessionStatusSchema,
  })
  .strict()

const EventBaseSchema = z
  .object({
    event_id: UuidSchema,
    adapter: z.string().min(1),
    adapter_version: z.string().min(1),
    device_uid: z.string().min(1),
    occurred_at: IsoDateTimeSchema,
  })
  .strict()

export const CanonicalEventSchema = z.discriminatedUnion("event_type", [
  EventBaseSchema.extend({
    event_type: z.literal("plugin.connected"),
    session_id: z.string().min(1).optional(),
    payload: PluginConnectedPayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("plugin.heartbeat"),
    session_id: z.string().min(1).optional(),
    payload: PluginHeartbeatPayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("device.activity"),
    session_id: z.string().min(1).optional(),
    payload: DeviceActivityPayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("session.created"),
    session_id: z.string().min(1),
    payload: SessionLifecyclePayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("session.updated"),
    session_id: z.string().min(1),
    payload: SessionLifecyclePayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("session.deleted"),
    session_id: z.string().min(1),
    payload: SessionLifecyclePayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("session.status"),
    session_id: z.string().min(1),
    payload: SessionStatusPayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("permission.asked"),
    session_id: z.string().min(1),
    payload: PermissionRequestPayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("permission.replied"),
    session_id: z.string().min(1),
    payload: PermissionRepliedPayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("question.asked"),
    session_id: z.string().min(1),
    payload: QuestionRequestPayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("question.replied"),
    session_id: z.string().min(1),
    payload: QuestionRepliedPayloadSchema,
  }).strict(),
  EventBaseSchema.extend({
    event_type: z.literal("question.rejected"),
    session_id: z.string().min(1),
    payload: QuestionRejectedPayloadSchema,
  }).strict(),
])

export const PluginEventsIngestRequestSchema = z
  .object({
    events: z.array(CanonicalEventSchema).min(1).max(500),
  })
  .strict()

export const PluginEventsIngestResponseSchema = z
  .object({
    accepted: z.number().int().nonnegative(),
    deduped: z.number().int().nonnegative(),
    errors: z.array(
      z
        .object({
          event_id: UuidSchema,
          code: z.string().min(1),
          message: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()

export const PluginHeartbeatRequestSchema = z
  .object({
    device_uid: z.string().min(1),
    plugin_version: z.string().min(1),
    uptime_sec: z.number().int().nonnegative(),
    active_session_ids: z.array(z.string().min(1)).default([]),
    sent_at: IsoDateTimeSchema,
  })
  .strict()

export const PluginActivityRequestSchema = z
  .object({
    device_uid: z.string().min(1),
    sample: DeviceActivityPayloadSchema,
  })
  .strict()

export const SessionStateSchema = z.enum(["busy", "retry", "idle", "unknown"])

export const SessionSummarySchema = z
  .object({
    session_id: z.string().min(1),
    title: z.string().min(1),
    state: SessionStateSchema,
    requires_attention: z.boolean(),
    attention_count: z.number().int().nonnegative(),
    last_event_at: IsoDateTimeSchema,
    last_attention_at: IsoDateTimeSchema.nullable(),
    is_stale: z.boolean(),
  })
  .strict()

export const DeviceActivitySummarySchema = z
  .object({
    is_active: z.boolean().nullable(),
    idle_seconds: z.number().int().nonnegative().nullable(),
    sampled_at: IsoDateTimeSchema,
  })
  .strict()

export const DeviceGroupSchema = z
  .object({
    device: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1).nullable(),
        platform: z.string().min(1).nullable(),
        last_seen_at: IsoDateTimeSchema.nullable(),
        activity: DeviceActivitySummarySchema.nullable(),
      })
      .strict(),
    sessions: z.array(SessionSummarySchema),
  })
  .strict()

export const SessionsOpenResponseSchema = z
  .object({
    groups: z.array(DeviceGroupSchema),
  })
  .strict()

export const AttentionRequestKindSchema = z.enum(["permission", "question"])
export const AttentionRequestStatusSchema = z.enum(["open", "resolved", "rejected", "expired"])

export const OpenAttentionRequestSchema = z
  .object({
    request_id: z.string().min(1),
    session_id: z.string().min(1),
    device_id: z.string().min(1),
    kind: AttentionRequestKindSchema,
    status: AttentionRequestStatusSchema,
    opened_at: IsoDateTimeSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()

export const RequestsOpenResponseSchema = z
  .object({
    requests: z.array(OpenAttentionRequestSchema),
  })
  .strict()

export const PermissionRespondRequestSchema = z
  .object({
    type: z.literal("permission"),
    decision: PermissionReplySchema,
    message: z.string().min(1).max(2000).optional(),
    client_action_id: UuidSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision !== "reject" && value.message !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "message is only allowed when decision is reject",
      })
    }
  })

export const QuestionRespondAnswersRequestSchema = z
  .object({
    type: z.literal("question"),
    answers: z.array(z.array(z.string().min(1))).min(1),
    client_action_id: UuidSchema,
  })
  .strict()

export const QuestionRespondRejectRequestSchema = z
  .object({
    type: z.literal("question"),
    decision: z.literal("reject"),
    client_action_id: UuidSchema,
  })
  .strict()

export const RequestRespondRequestSchema = z.union([
  PermissionRespondRequestSchema,
  QuestionRespondAnswersRequestSchema,
  QuestionRespondRejectRequestSchema,
])

export const RequestRespondAcceptedSchema = z
  .object({
    status: z.literal("accepted"),
    request_id: z.string().min(1),
    relay: z.literal("sent"),
  })
  .strict()

export const PushTokenPlatformSchema = z.enum(["ios", "android"])

export const PushTokenRegisterRequestSchema = z
  .object({
    expo_push_token: z.string().min(1),
    platform: PushTokenPlatformSchema,
    device_name: z.string().min(1).optional(),
    app_version: z.string().min(1).optional(),
  })
  .strict()

export const PatCreateRequestSchema = z
  .object({
    label: z.string().min(1).max(120),
  })
  .strict()

export const PatCreateResponseSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    token: z.string().min(1),
    created_at: IsoDateTimeSchema,
  })
  .strict()

export const PatListItemSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    token_prefix: z.string().min(1),
    created_at: IsoDateTimeSchema,
    last_used_at: IsoDateTimeSchema.nullable(),
    revoked_at: IsoDateTimeSchema.nullable(),
  })
  .strict()

export const PatListResponseSchema = z
  .object({
    pats: z.array(PatListItemSchema),
  })
  .strict()

export const PluginCommandTypeSchema = z.enum([
  "action.permission.reply",
  "action.question.reply",
  "action.question.reject",
])

export const PluginPermissionReplyCommandSchema = z
  .object({
    command_id: UuidSchema,
    type: z.literal("action.permission.reply"),
    request_id: z.string().min(1),
    session_id: z.string().min(1),
    payload: z
      .object({
        reply: PermissionReplySchema,
        message: z.string().min(1).max(2000).optional(),
      })
      .strict(),
  })
  .strict()

export const PluginQuestionReplyCommandSchema = z
  .object({
    command_id: UuidSchema,
    type: z.literal("action.question.reply"),
    request_id: z.string().min(1),
    session_id: z.string().min(1),
    payload: z
      .object({
        answers: z.array(z.array(z.string().min(1))).min(1),
      })
      .strict(),
  })
  .strict()

export const PluginQuestionRejectCommandSchema = z
  .object({
    command_id: UuidSchema,
    type: z.literal("action.question.reject"),
    request_id: z.string().min(1),
    session_id: z.string().min(1),
    payload: z.object({}).strict(),
  })
  .strict()

export const PluginCommandSchema = z.union([
  PluginPermissionReplyCommandSchema,
  PluginQuestionReplyCommandSchema,
  PluginQuestionRejectCommandSchema,
])

export const PluginCommandAckSchema = z
  .object({
    command_id: UuidSchema,
    accepted: z.boolean(),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict()

export const ApiErrorCodeSchema = z.enum([
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
])

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string().min(1),
        details: z.record(z.string(), z.unknown()).default({}),
      })
      .strict(),
  })
  .strict()

// Primitive types
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>
export type Uuid = z.infer<typeof UuidSchema>

// Event types
export type EventType = z.infer<typeof EventTypeSchema>
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>

// Session types
export type SessionInfo = z.infer<typeof SessionInfoSchema>
export type SessionStatus = z.infer<typeof SessionStatusSchema>
export type SessionState = z.infer<typeof SessionStateSchema>
export type SessionSummary = z.infer<typeof SessionSummarySchema>
export type SessionsOpenResponse = z.infer<typeof SessionsOpenResponseSchema>
export type DeviceGroup = z.infer<typeof DeviceGroupSchema>
export type DeviceActivitySummary = z.infer<typeof DeviceActivitySummarySchema>

// Attention request types
export type AttentionRequestKind = z.infer<typeof AttentionRequestKindSchema>
export type AttentionRequestStatus = z.infer<typeof AttentionRequestStatusSchema>
export type OpenAttentionRequest = z.infer<typeof OpenAttentionRequestSchema>
export type RequestsOpenResponse = z.infer<typeof RequestsOpenResponseSchema>

// Permission types
export type PermissionReply = z.infer<typeof PermissionReplySchema>
export type PermissionRequestPayload = z.infer<typeof PermissionRequestPayloadSchema>
export type PermissionRepliedPayload = z.infer<typeof PermissionRepliedPayloadSchema>

// Question types
export type QuestionOption = z.infer<typeof QuestionOptionSchema>
export type QuestionInfo = z.infer<typeof QuestionInfoSchema>
export type QuestionRequestPayload = z.infer<typeof QuestionRequestPayloadSchema>
export type QuestionRepliedPayload = z.infer<typeof QuestionRepliedPayloadSchema>
export type QuestionRejectedPayload = z.infer<typeof QuestionRejectedPayloadSchema>

// Plugin payload types
export type PluginConnectedPayload = z.infer<typeof PluginConnectedPayloadSchema>
export type PluginHeartbeatPayload = z.infer<typeof PluginHeartbeatPayloadSchema>
export type ActivityConfidence = z.infer<typeof ActivityConfidenceSchema>
export type DeviceActivityPayload = z.infer<typeof DeviceActivityPayloadSchema>
export type SessionLifecyclePayload = z.infer<typeof SessionLifecyclePayloadSchema>
export type SessionStatusPayload = z.infer<typeof SessionStatusPayloadSchema>

// Plugin endpoint request/response types
export type PluginEventsIngestRequest = z.infer<typeof PluginEventsIngestRequestSchema>
export type PluginEventsIngestResponse = z.infer<typeof PluginEventsIngestResponseSchema>
export type PluginHeartbeatRequest = z.infer<typeof PluginHeartbeatRequestSchema>
export type PluginActivityRequest = z.infer<typeof PluginActivityRequestSchema>

// App action request/response types
export type PermissionRespondRequest = z.infer<typeof PermissionRespondRequestSchema>
export type QuestionRespondAnswersRequest = z.infer<typeof QuestionRespondAnswersRequestSchema>
export type QuestionRespondRejectRequest = z.infer<typeof QuestionRespondRejectRequestSchema>
export type RequestRespondRequest = z.infer<typeof RequestRespondRequestSchema>
export type RequestRespondAccepted = z.infer<typeof RequestRespondAcceptedSchema>

// Push token types
export type PushTokenPlatform = z.infer<typeof PushTokenPlatformSchema>
export type PushTokenRegisterRequest = z.infer<typeof PushTokenRegisterRequestSchema>

// PAT types
export type PatCreateRequest = z.infer<typeof PatCreateRequestSchema>
export type PatCreateResponse = z.infer<typeof PatCreateResponseSchema>
export type PatListItem = z.infer<typeof PatListItemSchema>
export type PatListResponse = z.infer<typeof PatListResponseSchema>

// Plugin command types
export type PluginCommandType = z.infer<typeof PluginCommandTypeSchema>
export type PluginPermissionReplyCommand = z.infer<typeof PluginPermissionReplyCommandSchema>
export type PluginQuestionReplyCommand = z.infer<typeof PluginQuestionReplyCommandSchema>
export type PluginQuestionRejectCommand = z.infer<typeof PluginQuestionRejectCommandSchema>
export type PluginCommand = z.infer<typeof PluginCommandSchema>
export type PluginCommandAck = z.infer<typeof PluginCommandAckSchema>

// Error types
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>
