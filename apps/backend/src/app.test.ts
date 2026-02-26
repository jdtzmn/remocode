import {
  ApiErrorSchema,
  RequestsOpenResponseSchema,
  SessionsOpenResponseSchema,
} from "@remocode/contracts"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { createApp } from "./app"
import { createAppAuthMiddleware, createPluginAuthMiddleware } from "./auth/middleware"
import { ApiHttpError } from "./http/errors"
import { createPluginActivityService } from "./plugin-activity/service"
import type { PluginEventsIngestService } from "./plugin-events/ingest"
import { createPluginHeartbeatService } from "./plugin-heartbeat/service"
import { createRequestsOpenService } from "./requests/service"
import { createSessionsOpenService } from "./sessions/service"

const validJwt = "jwt-valid"
const validPat = "pat_validPrefix_validSecret"

function createProtectedApp(
  options: {
    pluginHeartbeat?: ReturnType<typeof createPluginHeartbeatService>
    pluginActivity?: ReturnType<typeof createPluginActivityService>
    pluginEventsIngest?: PluginEventsIngestService
    sessionsOpen?: ReturnType<typeof createSessionsOpenService>
    requestsOpen?: ReturnType<typeof createRequestsOpenService>
  } = {},
) {
  return createApp({
    appAuthMiddleware: createAppAuthMiddleware({
      verifyToken: async (token) => {
        if (token !== validJwt) {
          throw new ApiHttpError("UNAUTHORIZED", { message: "Invalid access token" })
        }

        return {
          userId: "user-1",
          supabaseUserId: "supabase-user-1",
          claims: { sub: "supabase-user-1" },
        }
      },
    }),
    pluginAuthMiddleware: createPluginAuthMiddleware({
      authenticate: async (token) => {
        if (token !== validPat) {
          throw new ApiHttpError("UNAUTHORIZED", { message: "Invalid personal access token" })
        }

        return {
          userId: "user-1",
          patId: "pat-1",
          tokenPrefix: "validPrefix",
        }
      },
    }),
    sessionsOpen:
      options.sessionsOpen ??
      createSessionsOpenService({
        getOpenSessions: async () => [],
      }),
    requestsOpen:
      options.requestsOpen ??
      createRequestsOpenService({
        getOpenRequests: async () => [],
      }),
    pluginHeartbeat:
      options.pluginHeartbeat ??
      createPluginHeartbeatService({
        recordHeartbeat: async () => undefined,
      }),
    pluginActivity:
      options.pluginActivity ??
      createPluginActivityService({
        recordActivity: async () => undefined,
      }),
    pluginEventsIngest:
      options.pluginEventsIngest ??
      (async () => ({
        accepted: 0,
        deduped: 0,
        errors: [],
      })),
  })
}

function createHeartbeatBody() {
  return {
    device_uid: "device-1",
    plugin_version: "1.0.0",
    uptime_sec: 60,
    active_session_ids: ["session-1"],
    sent_at: "2026-02-22T10:30:00.000Z",
  }
}

function createActivityBody() {
  return {
    device_uid: "device-1",
    sample: {
      is_active: true,
      idle_seconds: 0,
      frontmost_app: "Terminal",
      terminal_frontmost: true,
      sampled_at: "2026-02-22T10:30:00.000Z",
      confidence: "high",
    },
  }
}

describe("createApp", () => {
  it("returns ok for health endpoint", async () => {
    const app = createApp()
    const response = await app.request("/health")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it("returns not found for unknown routes", async () => {
    const app = createApp()
    const response = await app.request("/does-not-exist")
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({
      error: {
        code: "REQUEST_NOT_FOUND",
        message: "Route not found",
        details: {},
      },
    })
    expect(ApiErrorSchema.safeParse(body).success).toBe(true)
  })

  it("maps known API errors to canonical response", async () => {
    const app = createApp()

    app.get("/forbidden", () => {
      throw new ApiHttpError("FORBIDDEN", {
        message: "Access denied by policy",
        details: { policy: "workspace-readonly" },
      })
    })

    const response = await app.request("/forbidden")
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Access denied by policy",
        details: {
          policy: "workspace-readonly",
        },
      },
    })
    expect(ApiErrorSchema.safeParse(body).success).toBe(true)
  })

  it("maps unknown errors to INTERNAL_ERROR", async () => {
    const app = createApp()

    app.get("/explode", () => {
      throw new Error("boom")
    })

    const response = await app.request("/explode")
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        details: {},
      },
    })
    expect(ApiErrorSchema.safeParse(body).success).toBe(true)
  })

  it("maps zod validation errors to INVALID_PAYLOAD", async () => {
    const app = createApp()
    const querySchema = z.object({ count: z.coerce.number().int().min(1) })

    app.get("/validate", (context) => {
      querySchema.parse(context.req.query())
      return context.json({ ok: true })
    })

    const response = await app.request("/validate?count=0")
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      error: {
        code: "INVALID_PAYLOAD",
        message: "Invalid payload",
        details: {
          issues: [
            {
              path: "count",
            },
          ],
        },
      },
    })
    expect(ApiErrorSchema.safeParse(body).success).toBe(true)
  })

  it("authorizes app routes with JWT", async () => {
    const app = createProtectedApp()
    const response = await app.request("/v1/sessions/open", {
      headers: {
        authorization: `Bearer ${validJwt}`,
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ groups: [] })
  })

  it("authorizes plugin routes with PAT", async () => {
    const app = createProtectedApp()
    const response = await app.request("/v1/plugin/heartbeat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${validPat}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(createHeartbeatBody()),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it("rejects missing bearer token on protected routes", async () => {
    const app = createProtectedApp()
    const appResponse = await app.request("/v1/sessions/open")
    const pluginResponse = await app.request("/v1/plugin/heartbeat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(createHeartbeatBody()),
    })

    expect(appResponse.status).toBe(401)
    await expect(appResponse.json()).resolves.toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    })

    expect(pluginResponse.status).toBe(401)
    await expect(pluginResponse.json()).resolves.toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    })
  })

  it("rejects PAT on app routes and JWT on plugin routes", async () => {
    const app = createProtectedApp()

    const appResponse = await app.request("/v1/sessions/open", {
      headers: {
        authorization: `Bearer ${validPat}`,
      },
    })

    const pluginResponse = await app.request("/v1/plugin/heartbeat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${validJwt}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(createHeartbeatBody()),
    })

    expect(appResponse.status).toBe(401)
    await expect(appResponse.json()).resolves.toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    })

    expect(pluginResponse.status).toBe(401)
    await expect(pluginResponse.json()).resolves.toMatchObject({
      error: {
        code: "UNAUTHORIZED",
      },
    })
  })

  it("maps heartbeat payload validation failures to INVALID_PAYLOAD", async () => {
    const app = createProtectedApp()
    const response = await app.request("/v1/plugin/heartbeat", {
      method: "POST",
      headers: {
        authorization: `Bearer ${validPat}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      error: {
        code: "INVALID_PAYLOAD",
      },
    })
    expect(ApiErrorSchema.safeParse(body).success).toBe(true)
  })

  it("authorizes plugin activity route with PAT", async () => {
    const app = createProtectedApp()
    const response = await app.request("/v1/plugin/activity", {
      method: "POST",
      headers: {
        authorization: `Bearer ${validPat}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(createActivityBody()),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it("maps activity payload validation failures to INVALID_PAYLOAD", async () => {
    const app = createProtectedApp()
    const response = await app.request("/v1/plugin/activity", {
      method: "POST",
      headers: {
        authorization: `Bearer ${validPat}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        device_uid: "device-1",
      }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      error: {
        code: "INVALID_PAYLOAD",
      },
    })
    expect(ApiErrorSchema.safeParse(body).success).toBe(true)
  })

  it("ingests plugin events using PAT auth", async () => {
    const app = createProtectedApp({
      pluginEventsIngest: async () => ({
        accepted: 1,
        deduped: 1,
        errors: [
          {
            event_id: "22222222-2222-4222-8222-222222222222",
            code: "INVALID_PAYLOAD",
            message: "Invalid payload",
          },
        ],
      }),
    })

    const response = await app.request("/v1/plugin/events", {
      method: "POST",
      headers: {
        authorization: `Bearer ${validPat}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ events: [] }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accepted: 1,
      deduped: 1,
      errors: [
        {
          event_id: "22222222-2222-4222-8222-222222222222",
          code: "INVALID_PAYLOAD",
          message: "Invalid payload",
        },
      ],
    })
  })

  it("returns sessions/open with populated groups", async () => {
    const app = createProtectedApp({
      sessionsOpen: createSessionsOpenService({
        getOpenSessions: async () => [
          {
            sessionId: "session-abc",
            title: "Refactor auth",
            sessionState: "busy",
            requiresAttention: true,
            attentionCount: 1,
            lastEventAt: new Date("2026-02-22T10:00:00.000Z"),
            lastAttentionAt: new Date("2026-02-22T09:55:00.000Z"),
            isStale: false,
            deviceId: "device-1",
            deviceName: "MacBook Pro",
            devicePlatform: "darwin",
            deviceLastSeenAt: new Date("2026-02-22T10:00:00.000Z"),
            activityIsActive: true,
            activityIdleSeconds: 30,
            activitySampledAt: new Date("2026-02-22T09:59:00.000Z"),
          },
        ],
      }),
    })

    const response = await app.request("/v1/sessions/open", {
      headers: { authorization: `Bearer ${validJwt}` },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(SessionsOpenResponseSchema.safeParse(body).success).toBe(true)
    expect(body.groups).toHaveLength(1)
    expect(body.groups[0].device.name).toBe("MacBook Pro")
    expect(body.groups[0].sessions).toHaveLength(1)
    expect(body.groups[0].sessions[0].session_id).toBe("session-abc")
    expect(body.groups[0].sessions[0].requires_attention).toBe(true)
    expect(body.groups[0].device.activity).not.toBeNull()
  })

  it("rejects sessions/open without auth", async () => {
    const app = createProtectedApp()
    const response = await app.request("/v1/sessions/open")

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    })
  })

  it("returns requests/open with empty list when no open requests", async () => {
    const app = createProtectedApp()

    const response = await app.request("/v1/requests/open", {
      headers: { authorization: `Bearer ${validJwt}` },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(RequestsOpenResponseSchema.safeParse(body).success).toBe(true)
    expect(body).toEqual({ requests: [] })
  })

  it("returns requests/open with populated requests", async () => {
    const openedAt = new Date("2026-02-22T10:00:00.000Z")

    const app = createProtectedApp({
      requestsOpen: createRequestsOpenService({
        getOpenRequests: async () => [
          {
            requestId: "perm-req-1",
            sessionId: "session-abc",
            deviceId: "device-1",
            kind: "permission",
            status: "open",
            openedAt,
            payload: {
              id: "perm-req-1",
              sessionID: "session-abc",
              permission: "bash",
              patterns: ["npm install"],
            },
          },
          {
            requestId: "q-req-1",
            sessionId: "session-abc",
            deviceId: "device-1",
            kind: "question",
            status: "open",
            openedAt: new Date("2026-02-22T10:01:00.000Z"),
            payload: { id: "q-req-1", sessionID: "session-abc", questions: [] },
          },
        ],
      }),
    })

    const response = await app.request("/v1/requests/open", {
      headers: { authorization: `Bearer ${validJwt}` },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(RequestsOpenResponseSchema.safeParse(body).success).toBe(true)
    expect(body.requests).toHaveLength(2)
    expect(body.requests[0].request_id).toBe("perm-req-1")
    expect(body.requests[0].kind).toBe("permission")
    expect(body.requests[0].session_id).toBe("session-abc")
    expect(body.requests[1].request_id).toBe("q-req-1")
    expect(body.requests[1].kind).toBe("question")
  })

  it("rejects requests/open without auth", async () => {
    const app = createProtectedApp()
    const response = await app.request("/v1/requests/open")

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHORIZED" },
    })
  })
})
