# Contracts Reference (MVP)

This document defines the canonical transport contracts for the session attention system.

Source of truth:

- Runtime schemas and TypeScript types: `packages/contracts/src/index.ts`

Use this file for implementation alignment and API reviews. Use the TypeScript module for validation in code.

## 1. Versioning and Compatibility Rules

- Contract version is `v1` for this MVP.
- Backward-compatible additions are allowed (optional fields, new event types guarded by feature flags).
- Breaking changes require a new contract version (`v2`) and dual-read/write migration plan.
- Unknown fields in inbound payloads are rejected unless explicitly marked passthrough in schema.

## 2. Canonical Event Types

- `plugin.connected`
- `plugin.heartbeat`
- `device.activity`
- `session.created`
- `session.updated`
- `session.deleted`
- `session.status`
- `permission.asked`
- `permission.replied`
- `question.asked`
- `question.replied`
- `question.rejected`

## 3. Canonical Event Envelope

Every plugin event posted to backend must include:

- `event_id` (UUID, idempotency key)
- `adapter` (string, `opencode` for MVP)
- `adapter_version` (string)
- `device_uid` (stable per machine)
- `event_type` (one of canonical event types)
- `occurred_at` (ISO datetime with timezone)
- `session_id` (required for session/question/permission events)
- `payload` (event-specific schema)

Backend derives and does not trust from plugin payload:

- `user_id`
- `device_id`
- `received_at`

## 4. API Contract Surface

App-authenticated endpoints:

- `GET /v1/sessions/open`
- `GET /v1/requests/open`
- `POST /v1/requests/:requestId/respond`
- `POST /v1/push-tokens`
- `DELETE /v1/push-tokens/:id`
- `POST /v1/pats`
- `GET /v1/pats`
- `POST /v1/pats/:id/revoke`

Plugin-authenticated endpoints:

- `POST /v1/plugin/events`
- `POST /v1/plugin/heartbeat`
- `POST /v1/plugin/activity`

Socket.IO commands:

- server -> plugin: `action.permission.reply`, `action.question.reply`, `action.question.reject`
- plugin -> server: command ack envelope with `command_id`, `accepted`, `error`

## 5. Idempotency Rules

- Event ingest idempotency key: `event_id`.
- User action idempotency key: `client_action_id`.
- Duplicate action submissions must return deterministic response shape.

## 6. Error Contract

Standard error envelope:

```json
{
  "error": {
    "code": "PLUGIN_OFFLINE",
    "message": "Target device is offline",
    "details": {}
  }
}
```

Canonical error codes for MVP:

- `UNAUTHORIZED`
- `FORBIDDEN`
- `INVALID_PAYLOAD`
- `INVALID_EVENT_TYPE`
- `EVENT_DUPLICATE`
- `REQUEST_NOT_FOUND`
- `REQUEST_ALREADY_CLOSED`
- `PLUGIN_OFFLINE`
- `RELAY_TIMEOUT`
- `RELAY_EXECUTION_FAILED`
- `INVALID_QUESTION_ANSWERS`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

## 7. Implementation Guidance

- Validate all inbound payloads with `packages/contracts/src/index.ts`.
- Keep app-facing responses canonical and agent-agnostic.
- Store source payloads in event log for debugging.
- Treat unblock command ack as transport confirmation only; final state changes on replied/rejected event ingest.
