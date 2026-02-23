# Session Attention System - Implementation Plan (MVP)

## 0) Purpose and Audience

This document is the implementation handoff for building a production-usable MVP of a mobile session attention system.

Audience:

- engineers implementing backend, plugin, and mobile app
- engineers reviewing architecture/security
- future contributors adding non-OpenCode adapters

Goal of this plan:

- remove architectural ambiguity
- lock contracts, behaviors, and failure modes
- provide concrete payloads, endpoints, state machines, and sequencing

If implementation follows this document, no additional architectural decisions should be required for MVP.

---

## 1) Product Goals and Non-Goals

## 1.1 Product goals

Build a system where users can:

1. See currently open coding sessions grouped by device.
2. See blocker requests (permission requests and question prompts) immediately bubble to the top.
3. Receive push notifications when blockers occur while the computer is not actively used.
4. Resolve blockers from mobile (approve/reject permissions, answer/reject questions).
5. Use multiple devices per user and multiple users in the same system.

## 1.2 Explicit MVP non-goals

- no conversation history UI
- no message timeline storage for chat rendering
- no deferred unblock queue when plugin/device is offline
- no Windows/Linux-specific activity implementation (interface is cross-OS; implementation is macOS-first)

## 1.3 Success criteria

- blocker appears in app and reorders list in <= 2 seconds
- unblock action from app applies successfully on connected plugin
- offline plugin action returns explicit failure without ambiguity
- push notification behavior matches activity suppression policy
- correct isolation for user A vs user B and device A1 vs A2

---

## 2) Locked Decisions

- Mobile: Expo React Native
- UI stack: NativeWind + react-native-reusables
- App data/state: TanStack React Query + Zustand
- Backend runtime/framework: Node + Hono
- Realtime: Socket.IO (app updates + plugin command relay)
- Database: Postgres
- ORM/migrations: Drizzle ORM + drizzle-kit
- User authentication: Supabase Auth (JWT)
- Plugin authentication: backend-issued PATs (long-lived, revocable, hash-only storage)
- Push: Expo Push API + `mobile_push_tokens`
- Session ordering clock: backend `received_at`
- Session retention: stale sessions stay visible 10 minutes
- Offline unblock behavior: fail fast (no queue)
- OpenCode integration: hidden plugin with env PAT and plugin config; no wrapper command

---

## 3) OpenCode Research Findings (Codified)

These findings are based on OpenCode SDK/server/plugin source and are treated as implementation assumptions for adapter v1.

## 3.1 Plugin event hook semantics

OpenCode plugin runtime subscribes to internal bus events and invokes plugin `event` hook for each event.

Practical implication:

- adapter can observe event stream through plugin hook and forward selected events to backend

## 3.2 Relevant OpenCode event types and payloads

OpenCode exposes these event types we need:

- `session.created` with `properties.info: Session`
- `session.updated` with `properties.info: Session`
- `session.deleted` with `properties.info: Session`
- `session.status` with `properties.status: { type: "busy" | "retry" | "idle" }`
- `permission.asked` with `PermissionRequest`
- `permission.replied` with `{ sessionID, requestID, reply: "once" | "always" | "reject" }`
- `question.asked` with `QuestionRequest`
- `question.replied` with `{ sessionID, requestID, answers: string[][] }`
- `question.rejected` with `{ sessionID, requestID }`

Key payloads from OpenCode SDK types:

- `PermissionRequest`: `id`, `sessionID`, `permission`, `patterns[]`, `metadata`, `always[]`, optional `tool{messageID,callID}`
- `QuestionRequest`: `id`, `sessionID`, `questions[]`, optional `tool{messageID,callID}`
- `QuestionInfo`: `header`, `question`, `options[{label,description}]`, optional `multiple`, optional `custom`

## 3.3 OpenCode unblock APIs

OpenCode SDK supports:

- `permission.reply({ requestID, reply, message? })`
- `question.reply({ requestID, answers })`
- `question.reject({ requestID })`

This is the mechanism the plugin will execute when backend relays mobile action commands.

## 3.4 Heartbeat reality

OpenCode does **not** provide a native per-session plugin heartbeat event.

Therefore adapter must generate:

- `plugin.heartbeat`
- `device.activity`

## 3.5 Permission "always" behavior caveat

In current OpenCode permission engine:

- `always` adds allow rules to runtime-approved set
- persistence behavior is not guaranteed as durable user-managed policy in MVP context

Product copy and semantics in app must present this as:

- `Allow for this run` (not permanent global forever)

---

## 4) System Architecture

## 4.1 Components

1. Mobile app (Expo)
   - Supabase sign-in
   - initial data fetch
   - Socket.IO subscription for live state
   - unblock actions
   - push token registration

2. Backend API + realtime (Hono + Socket.IO)
   - app auth (Supabase JWT verify)
   - plugin auth (PAT verify)
   - event ingest and projection updates
   - action relay to plugin
   - push decision engine and dispatch

3. OpenCode adapter plugin
   - auto-start via OpenCode plugin config
   - captures OpenCode events
   - maps/forwards canonical events
   - sends heartbeat + activity
   - executes unblock commands via OpenCode SDK

4. Data store (Postgres)
   - append-only event log
   - session projection
   - attention request projection
   - auth/token/device/push records

## 4.2 Trust boundaries

- App client: untrusted beyond JWT signature
- Plugin client: untrusted beyond PAT validity
- Backend: source of truth for ownership/authorization decisions
- Postgres: durable source of truth

## 4.3 Realtime model

- app realtime: user-scoped Socket.IO room (`user:{userId}`)
- plugin realtime: device-scoped room (`device:{deviceId}`)
- commands only delivered to active socket for target device

---

## 5) Domain Model and State Machines

## 5.1 Core entities

- `User`: identity from Supabase mapped to internal UUID
- `Device`: a machine running plugin (`device_uid` stable per machine)
- `Session`: currently open/active coding context
- `AttentionRequest`: open blocker requiring human decision
- `Event`: immutable record of adapter signal

## 5.2 Session state model

Canonical `session_state` in projection:

- `busy`
- `retry`
- `idle`
- `unknown`

Derived flags:

- `is_open`
- `is_stale`
- `requires_attention`

Transition rules:

- `session.created` -> `is_open=true`, state from defaults
- `session.status` updates `session_state`
- `session.deleted` -> `is_open=false`
- stale timeout with no heartbeat/status -> `is_stale=true` but still visible during grace

## 5.3 Attention request state model

States:

- `open`
- `resolved`
- `rejected`
- `expired`

Transitions:

- `permission.asked` or `question.asked` -> `open`
- `permission.replied` (`once|always`) -> `resolved`
- `permission.replied` (`reject`) -> `rejected`
- `question.replied` -> `resolved`
- `question.rejected` -> `rejected`
- stale cleanup policy may mark orphaned open requests as `expired`

---

## 6) Canonical Event Contract

## 6.1 Event envelope (required)

```json
{
  "event_id": "uuid-v4",
  "adapter": "opencode",
  "adapter_version": "1.0.0",
  "device_uid": "stable-device-uuid",
  "event_type": "permission.asked",
  "session_id": "session_123",
  "occurred_at": "2026-02-21T22:45:12.120Z",
  "payload": {}
}
```

Backend adds:

- `received_at` (server now)
- `user_id` (derived from PAT)
- `device_id` (resolved/upserted device row)

## 6.2 Canonical event types (MVP)

1. `plugin.connected`
2. `plugin.heartbeat`
3. `device.activity`
4. `session.created`
5. `session.updated`
6. `session.deleted`
7. `session.status`
8. `permission.asked`
9. `permission.replied`
10. `question.asked`
11. `question.replied`
12. `question.rejected`

## 6.3 Payload schema details

### `plugin.connected`

```json
{
  "plugin_version": "1.0.0",
  "opencode_version": "x.y.z",
  "platform": "darwin",
  "hostname": "mbp-jacob",
  "capabilities": {
    "activity": true,
    "unblock_permission": true,
    "unblock_question": true
  }
}
```

### `plugin.heartbeat`

```json
{
  "uptime_sec": 174,
  "active_session_ids": ["session_1", "session_2"],
  "queue_depth": 0
}
```

### `device.activity`

```json
{
  "is_active": true,
  "idle_seconds": 24,
  "frontmost_app": "iTerm2",
  "terminal_frontmost": true,
  "sampled_at": "2026-02-21T22:45:13.105Z",
  "confidence": "high"
}
```

### `session.created` / `session.updated` / `session.deleted`

Payload mirrors OpenCode `Session` object under `info`:

```json
{
  "info": {
    "id": "session_abc",
    "title": "Refactor auth",
    "directory": "/Users/foo/repo",
    "projectID": "project_1",
    "time": {
      "created": 1708559400000,
      "updated": 1708559440000
    }
  }
}
```

### `session.status`

```json
{
  "sessionID": "session_abc",
  "status": {
    "type": "retry",
    "attempt": 2,
    "message": "rate limited",
    "next": 1708559500000
  }
}
```

### `permission.asked`

```json
{
  "id": "permission_01",
  "sessionID": "session_abc",
  "permission": "bash",
  "patterns": ["npm install"],
  "always": ["npm *"],
  "metadata": {
    "tool": "bash",
    "cwd": "/Users/foo/repo"
  },
  "tool": {
    "messageID": "msg_12",
    "callID": "call_99"
  }
}
```

### `permission.replied`

```json
{
  "sessionID": "session_abc",
  "requestID": "permission_01",
  "reply": "once"
}
```

### `question.asked`

```json
{
  "id": "question_01",
  "sessionID": "session_abc",
  "questions": [
    {
      "header": "Test Scope",
      "question": "Which tests should I run?",
      "options": [
        { "label": "Unit", "description": "Run unit tests only" },
        { "label": "All", "description": "Run all test suites" }
      ],
      "multiple": false,
      "custom": true
    }
  ],
  "tool": {
    "messageID": "msg_13",
    "callID": "call_100"
  }
}
```

### `question.replied`

```json
{
  "sessionID": "session_abc",
  "requestID": "question_01",
  "answers": [["All"]]
}
```

### `question.rejected`

```json
{
  "sessionID": "session_abc",
  "requestID": "question_01"
}
```

## 6.4 OpenCode -> canonical mapping table

| OpenCode event | Canonical event | Transform |
| --- | --- | --- |
| `session.created` | `session.created` | pass-through payload |
| `session.updated` | `session.updated` | pass-through payload |
| `session.deleted` | `session.deleted` | pass-through payload |
| `session.status` | `session.status` | pass-through payload |
| `permission.asked` | `permission.asked` | pass-through payload |
| `permission.replied` | `permission.replied` | pass-through payload |
| `question.asked` | `question.asked` | pass-through payload |
| `question.replied` | `question.replied` | pass-through payload |
| `question.rejected` | `question.rejected` | pass-through payload |
| plugin startup | `plugin.connected` | plugin-generated |
| periodic timer | `plugin.heartbeat` | plugin-generated |
| local activity probe | `device.activity` | plugin-generated |

---

## 7) API Specification

All routes are under `/v1`.

## 7.1 Authentication matrix

- App routes: `Authorization: Bearer <supabase_jwt>`
- Plugin routes: `Authorization: Bearer <pat_token>`

## 7.2 App endpoints

### `GET /v1/sessions/open`

Returns grouped session list sorted by attention and recency.

Response:

```json
{
  "groups": [
    {
      "device": {
        "id": "dev_1",
        "name": "MacBook Pro",
        "platform": "darwin",
        "last_seen_at": "2026-02-21T22:45:13.105Z",
        "activity": {
          "is_active": true,
          "idle_seconds": 24,
          "sampled_at": "2026-02-21T22:45:13.105Z"
        }
      },
      "sessions": [
        {
          "session_id": "session_abc",
          "title": "Refactor auth",
          "state": "busy",
          "requires_attention": true,
          "attention_count": 1,
          "last_event_at": "2026-02-21T22:45:12.120Z",
          "last_attention_at": "2026-02-21T22:45:12.120Z",
          "is_stale": false
        }
      ]
    }
  ]
}
```

### `GET /v1/requests/open`

Returns open attention requests grouped by session.

### `POST /v1/requests/:requestId/respond`

Permission response body:

```json
{
  "type": "permission",
  "decision": "always",
  "message": "Optional feedback for reject only",
  "client_action_id": "uuid"
}
```

Question reply body:

```json
{
  "type": "question",
  "answers": [["All"]],
  "client_action_id": "uuid"
}
```

Question reject body:

```json
{
  "type": "question",
  "decision": "reject",
  "client_action_id": "uuid"
}
```

Success response:

```json
{
  "status": "accepted",
  "request_id": "permission_01",
  "relay": "sent"
}
```

Error codes:

- `400 INVALID_PAYLOAD`
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 REQUEST_NOT_FOUND`
- `409 REQUEST_ALREADY_CLOSED`
- `409 PLUGIN_OFFLINE`
- `409 REQUEST_DEVICE_MISMATCH`
- `422 INVALID_QUESTION_ANSWERS`
- `504 RELAY_TIMEOUT`

### Push token endpoints

- `POST /v1/push-tokens`
- `DELETE /v1/push-tokens/:id`

### PAT endpoints

- `POST /v1/pats`
- `GET /v1/pats`
- `POST /v1/pats/:id/revoke`

PAT create response includes plaintext once:

```json
{
  "id": "pat_123",
  "label": "work-mac",
  "token": "pat_abc123_xxxxxxxxx",
  "created_at": "2026-02-21T22:45:12.120Z"
}
```

## 7.3 Plugin endpoints

### `POST /v1/plugin/events`

Body:

```json
{
  "events": [
    {
      "event_id": "uuid",
      "adapter": "opencode",
      "adapter_version": "1.0.0",
      "device_uid": "device-uuid",
      "event_type": "permission.asked",
      "session_id": "session_abc",
      "occurred_at": "2026-02-21T22:45:12.120Z",
      "payload": {}
    }
  ]
}
```

Response:

```json
{
  "accepted": 1,
  "deduped": 0,
  "errors": []
}
```

### `POST /v1/plugin/heartbeat`

Body includes plugin liveness and optional session IDs.

### `POST /v1/plugin/activity`

Body includes latest activity sample.

## 7.4 Idempotency rules

- event ingest idempotency: unique `event_id`
- action idempotency: unique `(user_id, client_action_id)`
- duplicate action response must be deterministic and return same terminal result envelope

---

## 8) Socket.IO Protocol

## 8.1 Namespaces

- `/app` for mobile clients
- `/plugin` for adapters

## 8.2 Rooms

- app joins `user:{userId}`
- plugin joins `device:{deviceId}` after auth handshake

## 8.3 Events (server -> app)

- `sessions.delta`
- `requests.delta`
- `request.resolved`
- `request.failed` (optional informational)

## 8.4 Events (server -> plugin)

- `action.permission.reply`
- `action.question.reply`
- `action.question.reject`

Command envelope:

```json
{
  "command_id": "uuid",
  "request_id": "permission_01",
  "session_id": "session_abc",
  "payload": {
    "reply": "once",
    "message": "optional"
  }
}
```

Plugin ack envelope:

```json
{
  "command_id": "uuid",
  "accepted": true,
  "error": null
}
```

Note: ack means command accepted for execution, not final request state. Final state changes on event ingestion.

---

## 9) Database Schema (Drizzle + Postgres)

## 9.1 Tables

### `users`

- `id uuid primary key`
- `supabase_user_id text not null unique`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### `devices`

- `id uuid primary key`
- `user_id uuid not null references users(id)`
- `device_uid text not null`
- `name text null`
- `platform text null`
- `last_seen_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- unique index on `(user_id, device_uid)`

### `personal_access_tokens`

- `id uuid primary key`
- `user_id uuid not null references users(id)`
- `token_prefix text not null unique`
- `secret_hash text not null`
- `label text not null`
- `last_used_at timestamptz null`
- `revoked_at timestamptz null`
- `created_at timestamptz not null default now()`

Indexes:

- `(user_id, revoked_at)`
- `(token_prefix)` unique

### `session_events`

- `id bigserial primary key`
- `event_id uuid not null unique`
- `user_id uuid not null references users(id)`
- `device_id uuid not null references devices(id)`
- `adapter text not null`
- `adapter_version text not null`
- `event_type text not null`
- `session_id text null`
- `occurred_at timestamptz not null`
- `received_at timestamptz not null default now()`
- `payload jsonb not null`

Indexes:

- `(user_id, received_at desc)`
- `(device_id, received_at desc)`
- `(session_id, received_at desc)` where `session_id is not null`
- `(event_type, received_at desc)`

### `session_projections`

- `session_id text primary key`
- `user_id uuid not null references users(id)`
- `device_id uuid not null references devices(id)`
- `title text null`
- `directory text null`
- `session_state text not null default 'unknown'`
- `requires_attention boolean not null default false`
- `attention_count int not null default 0`
- `last_attention_at timestamptz null`
- `last_event_at timestamptz not null`
- `last_status_at timestamptz null`
- `last_heartbeat_at timestamptz null`
- `stale_at timestamptz null`
- `is_stale boolean not null default false`
- `is_open boolean not null default true`
- `updated_at timestamptz not null default now()`

Indexes:

- `(user_id, is_open, requires_attention desc, last_attention_at desc, last_event_at desc)`
- `(device_id, is_open, requires_attention desc, last_attention_at desc, last_event_at desc)`

### `attention_requests`

- `request_id text primary key`
- `user_id uuid not null references users(id)`
- `device_id uuid not null references devices(id)`
- `session_id text not null`
- `kind text not null` (`permission` | `question`)
- `status text not null` (`open` | `resolved` | `rejected` | `expired`)
- `payload jsonb not null`
- `opened_at timestamptz not null`
- `resolved_at timestamptz null`
- `updated_at timestamptz not null default now()`

Indexes:

- `(user_id, status, opened_at desc)`
- `(session_id, status, opened_at desc)`

### `device_activity`

- `device_id uuid primary key references devices(id)`
- `is_active boolean null`
- `idle_seconds int null`
- `frontmost_app text null`
- `terminal_frontmost boolean null`
- `confidence text null`
- `sampled_at timestamptz not null`
- `updated_at timestamptz not null default now()`

### `mobile_push_tokens`

- `id uuid primary key`
- `user_id uuid not null references users(id)`
- `expo_push_token text not null unique`
- `platform text not null` (`ios` | `android`)
- `device_name text null`
- `app_version text null`
- `last_seen_at timestamptz not null`
- `revoked_at timestamptz null`
- `created_at timestamptz not null default now()`

Indexes:

- `(user_id, revoked_at)`
- partial unique optional on active token if needed

### `notification_log`

- `id uuid primary key`
- `user_id uuid not null`
- `device_id uuid not null`
- `request_id text not null`
- `decision text not null` (`sent` | `suppressed`)
- `reason text not null`
- `payload jsonb not null`
- `created_at timestamptz not null default now()`

### `action_attempts`

- `id uuid primary key`
- `user_id uuid not null`
- `client_action_id uuid not null`
- `request_id text not null`
- `status text not null` (`accepted` | `failed`)
- `error_code text null`
- `result jsonb not null`
- `created_at timestamptz not null default now()`

Unique:

- `(user_id, client_action_id)`

---

## 10) Projection and Ordering Algorithms

## 10.1 Ingest transaction algorithm

Per ingested event:

1. authenticate PAT -> resolve `user_id`
2. upsert `devices` by `(user_id, device_uid)`
3. insert into `session_events` with unique `event_id`
4. if unique violation: mark deduped and stop
5. update `session_projections` depending on `event_type`
6. update `attention_requests` if blocker event
7. compute notification decision for new open blockers
8. emit socket deltas to user room

All done in one DB transaction except push send call (which should be after commit, with log row written atomically before enqueue/send).

## 10.2 Session projection reducer rules

- `session.created`: create/upsert session, `is_open=true`, set `last_event_at`
- `session.updated`: update title/time metadata, bump `last_event_at`
- `session.deleted`: `is_open=false`, `requires_attention=false`
- `session.status`: set `session_state`, `last_status_at`, `last_event_at`
- `plugin.heartbeat`: set `last_heartbeat_at` for all included sessions
- stale evaluator job sets `is_stale` where `now - max(last_status_at,last_heartbeat_at,last_event_at) > 60s`

## 10.3 Attention reducer rules

- `permission.asked` / `question.asked`:
  - create or upsert `attention_requests` as `open`
  - increment session `attention_count`
  - set `requires_attention=true`, `last_attention_at=received_at`

- `permission.replied` / `question.replied` / `question.rejected`:
  - close matching request
  - recompute session `attention_count` from open requests
  - `requires_attention = attention_count > 0`

## 10.4 List sorting logic

Sessions within each device group sorted by:

1. `requires_attention DESC`
2. `last_attention_at DESC NULLS LAST`
3. `last_event_at DESC`

Device groups sorted by top session in each group using same key.

## 10.5 Visibility retention

- stale threshold: 60 seconds
- visibility grace for stale sessions: 10 minutes
- cleanup job archives/hides stale+old sessions from open list output

---

## 11) Notification Engine

## 11.1 Trigger condition

Trigger candidate on:

- `permission.asked`
- `question.asked`

## 11.2 Suppression decision matrix

Inputs:

- latest `device_activity` sample for source device
- sample freshness (<= 45s)
- `is_active`
- `idle_seconds`

Rules:

1. if sample fresh and `is_active=true` and `idle_seconds < 120` -> suppress
2. else -> send

Unknown/stale activity defaults to send (fail-open for attention-critical workflow).

## 11.3 Dedupe

- dedupe by `request_id`
- exactly one notification per unique open request
- reopening a logically new request gets a new request id and new send eligibility

## 11.4 Push payload

```json
{
  "title": "Action needed: Refactor auth",
  "body": "Permission request on MacBook Pro",
  "data": {
    "request_id": "permission_01",
    "session_id": "session_abc",
    "device_id": "dev_1",
    "kind": "permission"
  }
}
```

---

## 12) Unblock Command Flow (Authoritative)

## 12.1 Permission response sequence

1. App sends `POST /requests/:id/respond` with `decision`.
2. Backend validates ownership and request `open` state.
3. Backend checks live plugin socket on target device.
4. If not connected -> `409 PLUGIN_OFFLINE`.
5. If connected -> emit `action.permission.reply` with `command_id`.
6. Wait for plugin ack (timeout 8s).
7. Return `accepted` if ack successful.
8. Final request closure occurs when `permission.replied` event ingested.

## 12.2 Question response sequence

Same flow using:

- `action.question.reply` with `answers`
- or `action.question.reject`

## 12.3 Failure behavior

- plugin ack timeout -> `504 RELAY_TIMEOUT`
- plugin execution error -> `409 RELAY_EXECUTION_FAILED`
- request already closed -> `409 REQUEST_ALREADY_CLOSED`

No offline queue is attempted in MVP.

---

## 13) OpenCode Plugin Design

## 13.1 Installation and config

- plugin configured in OpenCode plugin list
- env var `SESSION_AGENT_PAT` supplied by user
- plugin auto-runs; user does not invoke special wrapper

## 13.2 Device identity

Generate persistent local `device_uid` once and reuse.

Recommended location:

- macOS: file in OpenCode plugin state dir (e.g. `~/.config/<plugin>/device-id`)

If missing, create UUID v4 and persist.

## 13.3 Startup procedure

1. read PAT + backend URL
2. resolve/generate `device_uid`
3. open Socket.IO connection to `/plugin`
4. authenticate socket with PAT + device_uid + metadata
5. emit `plugin.connected` event
6. start heartbeat timer (15s)
7. start activity sampler (15s)

## 13.4 OpenCode event forwarding

In plugin `event` hook:

- filter to tracked OpenCode event types
- normalize to canonical envelope
- send to `POST /v1/plugin/events` in small batches

Batching guidance:

- flush every 250ms or 50 events, whichever first
- immediate flush for blocker events (`permission.asked`, `question.asked`)

## 13.5 Command handling

On socket command:

- validate payload
- call OpenCode SDK method
- return ack success/failure
- rely on subsequent OpenCode `*.replied/*.rejected` event for final source-of-truth closure

## 13.6 Plugin resiliency

- exponential reconnect (1s, 2s, 4s, ... max 30s)
- HTTP retry with jitter for event posts
- local memory queue (bounded) for transient outage
- if queue over cap, drop oldest non-critical events first; never drop blocker events before reporting overflow metric

---

## 14) Activity Provider (macOS-first, cross-OS interface)

## 14.1 Interface

```ts
interface ActivityProvider {
  getIdleSeconds(): Promise<number | null>
  isUserActive(thresholdSec: number): Promise<boolean | null>
  getFrontmostApp(): Promise<string | null>
  getTerminalFrontmost(): Promise<boolean | null>
}
```

## 14.2 macOS implementation guidance

- use system idle APIs or a reliable shell/OS query utility
- map unknown/errors to null values
- avoid blocking plugin event loop on activity sampling failures

## 14.3 Cross-OS compatibility

Keep emitted event shape stable regardless of OS.

- unsupported field -> `null`
- unsupported confidence -> `low` or `unknown`

---

## 15) Mobile App Architecture

## 15.1 Screens

1. Auth screen (Supabase login)
2. Main attention screen
   - grouped by device
   - attention-first sessions
   - inline blocker cards
3. Request action sheet/modal
   - permission action buttons
   - question option selection + submit/reject
4. Settings
   - PAT management links (or deep links to web settings if desired)
   - push token status

## 15.2 Data model in app

- React Query:
  - `sessionsOpen`
  - `requestsOpen`
- Zustand:
  - expanded device groups
  - active action modal state
  - transient request action pending states

## 15.3 Realtime updates

- initial fetch on app foreground
- socket deltas patch query cache
- periodic safety refetch every 60 seconds while app foregrounded

## 15.4 UX behavior requirements

- blocker insertion animates at top of relevant session/device
- unresolved request badge count visible at both session and device level
- action buttons disabled while request action is pending
- on `PLUGIN_OFFLINE`, show explicit error: `Device is offline. Reconnect and try again.`

## 15.5 Permission UI copy

Buttons:

- `Allow once`
- `Allow for this run`
- `Reject`

Reason: OpenCode `always` should not be represented as permanent global permission.

---

## 16) Authentication and Security

## 16.1 User auth

- Supabase JWT verified server-side using JWKS
- internal user row created on first valid login

## 16.2 PAT design

Token format:

- `pat_<prefix>_<secret>`

Storage:

- store `prefix` plaintext (lookup key)
- store `secret_hash` with Argon2id
- never store plaintext secret

Validation:

1. parse token prefix
2. fetch PAT row by prefix
3. reject if revoked
4. Argon2id verify secret
5. update `last_used_at`

Revocation:

- set `revoked_at`
- effective immediately

## 16.3 Authorization rules

- app user can only view/act on own devices/sessions/requests
- plugin PAT can only write events for its owning user
- backend ignores any client-supplied user identifiers in plugin payloads

## 16.4 Logging and redaction

Never log:

- PAT secrets
- full JWTs
- raw push tokens in plaintext logs

Mask strategy:

- PAT prefix only
- push token hashed in logs

---

## 17) Error Model

Standard JSON error response:

```json
{
  "error": {
    "code": "PLUGIN_OFFLINE",
    "message": "Target device is offline",
    "details": {}
  }
}
```

Canonical error codes:

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

---

## 18) Observability and Operations

## 18.1 Structured logs

Log keys on all critical paths:

- `request_id`, `session_id`, `device_id`, `user_id`, `event_id`, `command_id`, `client_action_id`

## 18.2 Metrics

- events ingested/sec by type
- dedupe count
- projection update latency
- socket connected devices/users
- action relay success/failure/timeout
- notification sent/suppressed counts
- app fetch p95 latency

## 18.3 Alerts

- relay timeout rate > threshold
- ingest failure rate > threshold
- push send failure burst
- plugin online count sudden drop

---

## 19) Deployment and Environment

## 19.1 Environment variables (backend)

- `DATABASE_URL`
- `SUPABASE_JWKS_URL`
- `SUPABASE_ISSUER`
- `SUPABASE_AUDIENCE`
- `EXPO_ACCESS_TOKEN`
- `SOCKET_IO_CORS_ORIGIN`
- `PAT_HASH_PEPPER`
- `NODE_ENV`

## 19.2 Environment variables (plugin)

- `SESSION_AGENT_PAT`
- `SESSION_AGENT_BACKEND_URL`
- `SESSION_AGENT_DEVICE_NAME` (optional override)

## 19.3 Environment variables (app)

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_SOCKET_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## 19.4 Runtime assumptions

- backend runs in Node environment supporting Hono and Socket.IO server
- HTTPS in production
- Postgres with migrations managed by drizzle-kit

---

## 20) Implementation Plan (Work Packages)

## WP1: Repo scaffolding and contracts

Deliverables:

- monorepo or multi-package structure decided and created
- shared TypeScript contract package for canonical events and API schemas
- lint/format/type/test baseline (Biome + TypeScript + Vitest + CI)

Suggested package layout:

```text
apps/mobile
apps/backend
packages/contracts
packages/opencode-plugin
```

## WP2: Backend foundation

Deliverables:

- Hono server boot
- Supabase JWT middleware
- PAT middleware
- Drizzle schema + first migration

## WP3: Event ingest + projections

Deliverables:

- `/plugin/events`, `/plugin/heartbeat`, `/plugin/activity`
- reducer logic for `session_projections` and `attention_requests`
- list/read endpoints for app

## WP4: Socket.IO realtime

Deliverables:

- `/app` and `/plugin` namespaces
- room join/auth logic
- delta emission on projection updates

## WP5: Unblock command path

Deliverables:

- `POST /requests/:id/respond`
- relay to plugin + ack handling
- idempotency via `client_action_id`

## WP6: OpenCode plugin adapter

Deliverables:

- plugin startup/auth
- event hook mapper + sender
- heartbeat/activity timers
- unblock command executor

## WP7: Mobile app UX

Deliverables:

- auth flow
- grouped session list
- blocker cards and action modals
- push token registration
- socket-driven live updates

## WP8: Notification engine

Deliverables:

- suppression matrix implementation
- Expo push sender
- `notification_log` writes

## WP9: Hardening

Deliverables:

- retries, rate limits, robust errors
- metrics + alerts
- QA scenario completion

---

## 21) Detailed Testing Plan

## 21.1 Unit tests

- canonical schema validation
- event mapping from OpenCode payloads
- projection reducer transitions
- notification decision matrix
- PAT parse + verify + revocation logic

## 21.2 Integration tests

- ingest endpoint idempotency under duplicate event IDs
- action relay to mocked plugin socket
- request lifecycle open -> resolved/rejected
- multi-user data isolation

## 21.3 E2E scenarios (must pass)

1. Multi-device ordering
   - two devices, each with sessions
   - blocker on lower-ranked device moves that device group to top

2. Permission unblock
   - receive `permission.asked`
   - app `Allow once`
   - plugin applies and emits `permission.replied`
   - request closes and badge decrements

3. Question unblock
   - receive `question.asked` with options
   - app submit answers
   - plugin replies and request closes

4. Offline fail-fast
   - disconnect plugin
   - action returns `PLUGIN_OFFLINE`
   - request remains open

5. Notification suppression
   - active device => suppressed
   - inactive/unknown => sent

6. User isolation
   - user A cannot view or act on user B requests

---

## 22) Acceptance Checklist

MVP is complete when all are true:

- [ ] User auth works via Supabase and backend authorization
- [ ] PAT creation/list/revoke works and hash-only storage verified
- [ ] OpenCode plugin can connect and emit all tracked events
- [ ] App shows grouped open sessions with attention-first ordering
- [ ] Blockers appear immediately and bump list order
- [ ] App unblock actions work for permissions and questions
- [ ] Offline actions fail fast with explicit error
- [ ] Notifications follow suppression policy and are logged
- [ ] Multi-user and multi-device tests pass
- [ ] Observability baseline dashboards and alerts exist

---

## 23) Risks and Mitigations

1. OpenCode event contract drift
   - Mitigation: strict adapter version tagging, schema guards, contract tests against pinned SDK types.

2. Activity detection inconsistency on macOS versions
   - Mitigation: confidence flags + fail-open notification policy.

3. Realtime race conditions (action vs event close)
   - Mitigation: idempotent action records and request terminal state checks before/after relay.

4. Plugin disconnect spikes
   - Mitigation: reconnect backoff and explicit fail-fast UX.

5. Push token churn
   - Mitigation: update `last_seen_at`, revoke invalid tokens on send failures.

---

## 24) Post-MVP Extension Path

Planned future additions (outside this MVP):

- non-OpenCode adapters using same canonical event contract
- richer history/thread view and message storage
- queued deferred actions for offline devices
- user-tunable notification routing and quiet hours
- Windows/Linux activity providers

---

## 25) Final Notes to Implementers

1. Treat this plan as contract-first: implement `packages/contracts` first.
2. Do not leak OpenCode-specific shapes into app-facing response models.
3. Preserve raw payloads in `session_events.payload` for forensic debugging.
4. Keep unblock finality event-driven (`*.replied/*.rejected`), not relay-ack driven.
5. Preserve fail-fast offline behavior exactly as specified for MVP.

---

## 26) Code Quality Gates (Linting, Formatting, Type Safety)

## 26.1 Tooling (Locked)

- formatter + linter: Biome
- type safety: TypeScript (`tsc --noEmit`)
- tests: Vitest (unit + integration)

## 26.2 Required commands

- `format`: `biome format --write .`
- `format:check`: `biome format .`
- `lint`: `biome lint .`
- `check`: `biome check .`
- `typecheck`: `tsc -b --noEmit`
- `test`: `vitest run`
- `ci`: `npm run check && npm run typecheck && npm run test`

## 26.3 CI policy (merge blocking)

Any pull request must fail if one of these fails:

1. `check`
2. `typecheck`
3. `test`
4. Drizzle migration apply check (only when schema changed)

## 26.4 Quality definition of done addendum

A change is not done unless it is:

- formatted
- lint-clean
- type-safe
- test-passing
- migration-complete (if schema changed)
- contract docs updated (if contract shape changed)

---

## 27) OpenCode-Driven Expo Feedback Loop

## 27.1 MCP stack (locked)

- `XcodeBuildMCP` for build/run/log/test workflows
- `ios-simulator-mcp` for simulator UI interactions and accessibility inspection
- `swiftlens` for Swift/native code assistance

Note: do not include `context7` in this project setup.

## 27.2 MCP server runtime convention

Use `bunx` for MCP server commands in OpenCode config for this project.

Example:

```json
{
  "mcp": {
    "XcodeBuildMCP": {
      "type": "local",
      "command": ["bunx", "xcodebuildmcp@latest", "mcp"],
      "enabled": true
    },
    "ios-simulator": {
      "type": "local",
      "command": ["bunx", "ios-simulator-mcp@latest"],
      "enabled": true
    },
    "swiftlens": {
      "type": "local",
      "command": ["uvx", "swiftlens"],
      "enabled": true
    }
  }
}
```

## 27.3 Tight development loop

1. start backend and Expo dev server
2. launch app in iOS simulator
3. run scripted simulator checks (describe screen, tap/type/swipe, screenshot)
4. validate app state changes for session ordering and blockers
5. apply code changes
6. rerun same flow until stable

## 27.4 Required smoke scenarios

- auth success and initial data hydration
- group-by-device ordering correctness
- `permission.asked` bumps session/device to top
- `question.asked` bumps session/device to top
- permission allow/reject round-trip succeeds
- question answer/reject round-trip succeeds
- offline unblock action returns `PLUGIN_OFFLINE`
- notification suppression works when device is active

---

## 28) Beads Issue Tracking Workflow (Locked)

## 28.1 Install and initialize

- install Beads CLI (`bd`) globally
- run `bd init` in this repository
- include guidance in project instructions: use `bd` for issue tracking

## 28.2 Operating rules

- every non-trivial engineering task maps to a Beads issue
- use explicit state transitions: `open` -> `in_progress` -> `closed`
- model blockers with dependencies (`bd dep add`)
- include acceptance criteria on the issue before implementation
- close issues immediately when completed

## 28.3 Core command set

- `bd ready`
- `bd create "Title" -p <priority>`
- `bd update <id> --claim`
- `bd update <id> --status in_progress`
- `bd dep add <child> <parent>`
- `bd close <id> --reason "Completed"`

## 28.4 Commit hygiene

- include Beads issue ID in commit messages (example: `Implement relay timeout handling (bd-abc)`)
- if code merges while issue remains open, reconcile issue status in the same session

## 28.5 Source-of-truth boundaries

- Beads is the source of truth for active task planning and execution status
- `PLAN.md` is the source of truth for architecture and implementation contracts
