import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"

import type { AuthBindings } from "./auth/types"
import { ApiHttpError, toApiErrorResponse, toApiHttpError } from "./http/errors"
import { rateLimitMiddleware } from "./http/rate-limit"
import { globalMetrics } from "./metrics"
import type { PatCreateService, PatListService, PatRevokeService } from "./pats/service"
import type { PluginActivityService } from "./plugin-activity/service"
import type { PluginEventsIngestService } from "./plugin-events/ingest"
import type { PluginHeartbeatService } from "./plugin-heartbeat/service"
import type { PushTokenDeleteService, PushTokenRegisterService } from "./push-tokens/service"
import type { RequestRespondService } from "./requests/respond-service"
import type { RequestsOpenService } from "./requests/service"
import type { SessionsOpenService } from "./sessions/service"

type CreateAppOptions = {
  appAuthMiddleware?: MiddlewareHandler<AuthBindings>
  pluginAuthMiddleware?: MiddlewareHandler<AuthBindings>
  pluginHeartbeat?: PluginHeartbeatService
  pluginActivity?: PluginActivityService
  pluginEventsIngest?: PluginEventsIngestService
  sessionsOpen?: SessionsOpenService
  requestsOpen?: RequestsOpenService
  requestsRespond?: RequestRespondService
  patCreate?: PatCreateService
  patList?: PatListService
  patRevoke?: PatRevokeService
  pushTokenRegister?: PushTokenRegisterService
  pushTokenDelete?: PushTokenDeleteService
}

function rejectWithUnauthorized(message: string): MiddlewareHandler<AuthBindings> {
  return async (context) => {
    return context.json(toApiErrorResponse("UNAUTHORIZED", message), 401)
  }
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<AuthBindings>()

  const pluginHeartbeat =
    options.pluginHeartbeat ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "Plugin heartbeat service is not configured",
      })
    })

  const pluginActivity =
    options.pluginActivity ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "Plugin activity service is not configured",
      })
    })

  const pluginEventsIngest =
    options.pluginEventsIngest ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "Plugin events ingest is not configured",
      })
    })

  const sessionsOpen =
    options.sessionsOpen ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "Sessions open service is not configured",
      })
    })

  const requestsOpen =
    options.requestsOpen ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "Requests open service is not configured",
      })
    })

  const requestsRespond =
    options.requestsRespond ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "Requests respond service is not configured",
      })
    })

  const patCreate =
    options.patCreate ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "PAT create service is not configured",
      })
    })

  const patList =
    options.patList ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "PAT list service is not configured",
      })
    })

  const patRevoke =
    options.patRevoke ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "PAT revoke service is not configured",
      })
    })

  const pushTokenRegister =
    options.pushTokenRegister ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "Push token register service is not configured",
      })
    })

  const pushTokenDelete =
    options.pushTokenDelete ??
    (async () => {
      throw new ApiHttpError("INTERNAL_ERROR", {
        message: "Push token delete service is not configured",
      })
    })

  app.onError((error, context) => {
    const apiError = toApiHttpError(error)

    return context.json(
      toApiErrorResponse(apiError.code, apiError.message, apiError.details),
      apiError.status,
    )
  })

  app.notFound((context) => {
    return context.json(toApiErrorResponse("REQUEST_NOT_FOUND", "Route not found"), 404)
  })

  app.get("/health", (context) => {
    return context.json({ ok: true })
  })

  app.get("/metrics", (context) => {
    return context.json(globalMetrics.snapshot())
  })

  app.use(
    "/v1/sessions/*",
    options.appAuthMiddleware ?? rejectWithUnauthorized("App authentication is not configured"),
  )

  app.get("/v1/sessions/open", async (context) => {
    const auth = context.get("appAuth")
    const t0 = Date.now()
    const response = await sessionsOpen({ userId: auth.userId })
    globalMetrics.recordFetchDuration("sessions.open", Date.now() - t0)
    return context.json(response)
  })

  app.use(
    "/v1/requests/*",
    options.appAuthMiddleware ?? rejectWithUnauthorized("App authentication is not configured"),
  )

  app.get("/v1/requests/open", async (context) => {
    const auth = context.get("appAuth")
    const t0 = Date.now()
    const response = await requestsOpen({ userId: auth.userId })
    globalMetrics.recordFetchDuration("requests.open", Date.now() - t0)
    return context.json(response)
  })

  app.post(
    "/v1/requests/:requestId/respond",
    // Limit unblock actions: 120 per user per minute
    rateLimitMiddleware({ max: 120, windowMs: 60_000 }),
    async (context) => {
      let body: unknown

      try {
        body = await context.req.json()
      } catch {
        throw new ApiHttpError("INVALID_PAYLOAD")
      }

      const auth = context.get("appAuth")
      const requestId = context.req.param("requestId")
      const response = await requestsRespond({ userId: auth.userId, requestId, payload: body })
      return context.json(response)
    },
  )

  app.use(
    "/v1/pats/*",
    options.appAuthMiddleware ?? rejectWithUnauthorized("App authentication is not configured"),
  )

  app.post(
    "/v1/pats",
    // Prevent rapid PAT creation: 20 per user per minute
    rateLimitMiddleware({ max: 20, windowMs: 60_000 }),
    async (context) => {
      let body: unknown

      try {
        body = await context.req.json()
      } catch {
        throw new ApiHttpError("INVALID_PAYLOAD")
      }

      const auth = context.get("appAuth")
      const response = await patCreate({ userId: auth.userId, payload: body })
      return context.json(response, 201)
    },
  )

  app.get("/v1/pats", async (context) => {
    const auth = context.get("appAuth")
    const response = await patList({ userId: auth.userId })
    return context.json(response)
  })

  app.post("/v1/pats/:patId/revoke", async (context) => {
    const auth = context.get("appAuth")
    const patId = context.req.param("patId")
    const response = await patRevoke({ userId: auth.userId, patId })
    return context.json(response)
  })

  app.use(
    "/v1/push-tokens/*",
    options.appAuthMiddleware ?? rejectWithUnauthorized("App authentication is not configured"),
  )

  app.post("/v1/push-tokens", async (context) => {
    let body: unknown

    try {
      body = await context.req.json()
    } catch {
      throw new ApiHttpError("INVALID_PAYLOAD")
    }

    const auth = context.get("appAuth")
    const response = await pushTokenRegister({ userId: auth.userId, payload: body })
    return context.json(response, 201)
  })

  app.delete("/v1/push-tokens/:tokenId", async (context) => {
    const auth = context.get("appAuth")
    const pushTokenId = context.req.param("tokenId")
    const response = await pushTokenDelete({ userId: auth.userId, pushTokenId })
    return context.json(response)
  })

  app.use(
    "/v1/plugin/*",
    options.pluginAuthMiddleware ??
      rejectWithUnauthorized("Plugin authentication is not configured"),
  )

  app.post(
    "/v1/plugin/heartbeat",
    // Heartbeat sends at most once per 15s, so 120/min is very generous
    rateLimitMiddleware({ max: 120, windowMs: 60_000 }),
    async (context) => {
      let body: unknown

      try {
        body = await context.req.json()
      } catch {
        throw new ApiHttpError("INVALID_PAYLOAD")
      }

      const auth = context.get("pluginAuth")
      const response = await pluginHeartbeat({
        userId: auth.userId,
        payload: body,
      })
      return context.json(response)
    },
  )

  app.post(
    "/v1/plugin/activity",
    // Activity samples at most once per 15s, so 120/min is very generous
    rateLimitMiddleware({ max: 120, windowMs: 60_000 }),
    async (context) => {
      let body: unknown

      try {
        body = await context.req.json()
      } catch {
        throw new ApiHttpError("INVALID_PAYLOAD")
      }

      const auth = context.get("pluginAuth")
      const response = await pluginActivity({
        userId: auth.userId,
        payload: body,
      })

      return context.json(response)
    },
  )

  app.post(
    "/v1/plugin/events",
    // Plugin batches events; 300/min per user allows bursts without abuse
    rateLimitMiddleware({ max: 300, windowMs: 60_000 }),
    async (context) => {
      // Reject oversized payloads (5MB limit) before parsing
      const contentLength = context.req.header("content-length")
      if (contentLength !== undefined) {
        const bytes = Number.parseInt(contentLength, 10)
        const maxBytes = 5 * 1024 * 1024 // 5 MB
        if (!Number.isNaN(bytes) && bytes > maxBytes) {
          throw new ApiHttpError("INVALID_PAYLOAD", {
            message: "Request body exceeds maximum allowed size",
          })
        }
      }

      let body: unknown

      try {
        body = await context.req.json()
      } catch {
        throw new ApiHttpError("INVALID_PAYLOAD")
      }

      const auth = context.get("pluginAuth")
      const response = await pluginEventsIngest({
        userId: auth.userId,
        payload: body,
      })

      return context.json(response)
    },
  )

  return app
}
