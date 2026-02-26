import { ApiErrorSchema } from "@remocode/contracts"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { createApp } from "./app"
import { createAppAuthMiddleware, createPluginAuthMiddleware } from "./auth/middleware"
import { ApiHttpError } from "./http/errors"
import type { PluginEventsIngestService } from "./plugin-events/ingest"

const validJwt = "jwt-valid"
const validPat = "pat_validPrefix_validSecret"

function createProtectedApp(options: { pluginEventsIngest?: PluginEventsIngestService } = {}) {
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
})
