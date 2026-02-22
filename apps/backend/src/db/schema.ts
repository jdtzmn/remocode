import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

import {
  actionAttemptStatusEnum,
  activityConfidenceEnum,
  attentionRequestKindEnum,
  attentionRequestStatusEnum,
  devicePlatformEnum,
  mobilePlatformEnum,
  notificationDecisionEnum,
  sessionStateEnum,
} from "./enums"

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supabaseUserId: text("supabase_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    supabaseUserIdUnique: uniqueIndex("users_supabase_user_id_uq").on(table.supabaseUserId),
  }),
)

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceUid: text("device_uid").notNull(),
    name: text("name"),
    platform: devicePlatformEnum("platform"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userDeviceUidUnique: uniqueIndex("devices_user_device_uid_uq").on(table.userId, table.deviceUid),
    userIdIndex: index("devices_user_id_idx").on(table.userId),
  }),
)

export const personalAccessTokens = pgTable(
  "personal_access_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenPrefix: text("token_prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    label: text("label").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tokenPrefixUnique: uniqueIndex("personal_access_tokens_token_prefix_uq").on(table.tokenPrefix),
    userRevokedIndex: index("personal_access_tokens_user_revoked_idx").on(table.userId, table.revokedAt),
  }),
)

export const sessionEvents = pgTable(
  "session_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: uuid("event_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    adapter: text("adapter").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    eventType: text("event_type").notNull(),
    sessionId: text("session_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (table) => ({
    eventIdUnique: uniqueIndex("session_events_event_id_uq").on(table.eventId),
    userReceivedIndex: index("session_events_user_received_idx").on(table.userId, table.receivedAt),
    deviceReceivedIndex: index("session_events_device_received_idx").on(table.deviceId, table.receivedAt),
    sessionReceivedIndex: index("session_events_session_received_idx").on(table.sessionId, table.receivedAt),
    eventTypeReceivedIndex: index("session_events_event_type_received_idx").on(table.eventType, table.receivedAt),
  }),
)

export const sessionProjections = pgTable(
  "session_projections",
  {
    sessionId: text("session_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    title: text("title"),
    directory: text("directory"),
    sessionState: sessionStateEnum("session_state").default("unknown").notNull(),
    requiresAttention: boolean("requires_attention").default(false).notNull(),
    attentionCount: integer("attention_count").default(0).notNull(),
    lastAttentionAt: timestamp("last_attention_at", { withTimezone: true }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
    lastStatusAt: timestamp("last_status_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    staleAt: timestamp("stale_at", { withTimezone: true }),
    isStale: boolean("is_stale").default(false).notNull(),
    isOpen: boolean("is_open").default(true).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userOpenAttentionIndex: index("session_projections_user_open_attention_idx").on(
      table.userId,
      table.isOpen,
      table.requiresAttention,
      table.lastAttentionAt,
      table.lastEventAt,
    ),
    deviceOpenAttentionIndex: index("session_projections_device_open_attention_idx").on(
      table.deviceId,
      table.isOpen,
      table.requiresAttention,
      table.lastAttentionAt,
      table.lastEventAt,
    ),
  }),
)

export const attentionRequests = pgTable(
  "attention_requests",
  {
    requestId: text("request_id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    kind: attentionRequestKindEnum("kind").notNull(),
    status: attentionRequestStatusEnum("status").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userStatusOpenedIndex: index("attention_requests_user_status_opened_idx").on(
      table.userId,
      table.status,
      table.openedAt,
    ),
    sessionStatusOpenedIndex: index("attention_requests_session_status_opened_idx").on(
      table.sessionId,
      table.status,
      table.openedAt,
    ),
  }),
)

export const deviceActivity = pgTable(
  "device_activity",
  {
    deviceId: uuid("device_id")
      .primaryKey()
      .references(() => devices.id, { onDelete: "cascade" }),
    isActive: boolean("is_active"),
    idleSeconds: integer("idle_seconds"),
    frontmostApp: text("frontmost_app"),
    terminalFrontmost: boolean("terminal_frontmost"),
    confidence: activityConfidenceEnum("confidence"),
    sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sampledAtIndex: index("device_activity_sampled_at_idx").on(table.sampledAt),
  }),
)

export const mobilePushTokens = pgTable(
  "mobile_push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expoPushToken: text("expo_push_token").notNull(),
    platform: mobilePlatformEnum("platform").notNull(),
    deviceName: text("device_name"),
    appVersion: text("app_version"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    expoPushTokenUnique: uniqueIndex("mobile_push_tokens_expo_push_token_uq").on(table.expoPushToken),
    userRevokedIndex: index("mobile_push_tokens_user_revoked_idx").on(table.userId, table.revokedAt),
  }),
)

export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    decision: notificationDecisionEnum("decision").notNull(),
    reason: text("reason").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userCreatedIndex: index("notification_log_user_created_idx").on(table.userId, table.createdAt),
    requestCreatedIndex: index("notification_log_request_created_idx").on(table.requestId, table.createdAt),
  }),
)

export const actionAttempts = pgTable(
  "action_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientActionId: uuid("client_action_id").notNull(),
    requestId: text("request_id").notNull(),
    status: actionAttemptStatusEnum("status").notNull(),
    errorCode: text("error_code"),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userClientActionUnique: uniqueIndex("action_attempts_user_client_action_uq").on(
      table.userId,
      table.clientActionId,
    ),
    requestCreatedIndex: index("action_attempts_request_created_idx").on(table.requestId, table.createdAt),
  }),
)

export const schema = {
  users,
  devices,
  personalAccessTokens,
  sessionEvents,
  sessionProjections,
  attentionRequests,
  deviceActivity,
  mobilePushTokens,
  notificationLog,
  actionAttempts,
}
