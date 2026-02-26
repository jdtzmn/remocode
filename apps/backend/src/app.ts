import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"

import { SessionsOpenResponseSchema } from "@remocode/contracts"

import type { AuthBindings } from "./auth/types"
import { ApiHttpError, toApiErrorResponse, toApiHttpError } from "./http/errors"
import type { PluginActivityService } from "./plugin-activity/service"
import type { PluginEventsIngestService } from "./plugin-events/ingest"
import type { PluginHeartbeatService } from "./plugin-heartbeat/service"

type CreateAppOptions = {
  appAuthMiddleware?: MiddlewareHandler<AuthBindings>
  pluginAuthMiddleware?: MiddlewareHandler<AuthBindings>
  pluginHeartbeat?: PluginHeartbeatService
  pluginActivity?: PluginActivityService
  pluginEventsIngest?: PluginEventsIngestService
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

  app.use(
    "/v1/sessions/*",
    options.appAuthMiddleware ?? rejectWithUnauthorized("App authentication is not configured"),
  )

  app.get("/v1/sessions/open", (context) => {
    context.get("appAuth")
    return context.json(SessionsOpenResponseSchema.parse({ groups: [] }))
  })

  app.use(
    "/v1/plugin/*",
    options.pluginAuthMiddleware ??
      rejectWithUnauthorized("Plugin authentication is not configured"),
  )

  app.post("/v1/plugin/heartbeat", async (context) => {
    let body: unknown

    try {
      body = await context.req.json()
    } catch {
      throw new ApiHttpError("INVALID_PAYLOAD")
    }

    context.get("pluginAuth")
    const auth = context.get("pluginAuth")
    const response = await pluginHeartbeat({
      userId: auth.userId,
      payload: body,
    })
    return context.json(response)
  })

  app.post("/v1/plugin/activity", async (context) => {
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
  })

  app.post("/v1/plugin/events", async (context) => {
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
  })

  return app
}
