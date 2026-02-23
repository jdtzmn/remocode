import { pgEnum } from "drizzle-orm/pg-core"

export const sessionStateEnum = pgEnum("session_state", ["busy", "retry", "idle", "unknown"])

export const attentionRequestKindEnum = pgEnum("attention_request_kind", ["permission", "question"])
export const attentionRequestStatusEnum = pgEnum("attention_request_status", [
  "open",
  "resolved",
  "rejected",
  "expired",
])

export const devicePlatformEnum = pgEnum("device_platform", [
  "darwin",
  "linux",
  "windows",
  "unknown",
])
export const mobilePlatformEnum = pgEnum("mobile_platform", ["ios", "android"])

export const activityConfidenceEnum = pgEnum("activity_confidence", [
  "high",
  "medium",
  "low",
  "unknown",
])
export const notificationDecisionEnum = pgEnum("notification_decision", ["sent", "suppressed"])
export const actionAttemptStatusEnum = pgEnum("action_attempt_status", ["accepted", "failed"])
