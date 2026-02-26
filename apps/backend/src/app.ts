import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"

import { PluginHeartbeatRequestSchema, SessionsOpenResponseSchema } from "@remocode/contracts"

import type { AuthBindings } from "./auth/types"
import { ApiHttpError, toApiErrorResponse, toApiHttpError } from "./http/errors"
import type { PluginEventsIngestService } from "./plugin-events/ingest"

type CreateAppOptions = {
  appAuthMiddleware?: MiddlewareHandler<AuthBindings>
  pluginAuthMiddleware?: MiddlewareHandler<AuthBindings>
  pluginEventsIngest?: PluginEventsIngestService
}

function rejectWithUnauthorized(message: string): MiddlewareHandler<AuthBindings> {
  return async (context) => {
    return context.json(toApiErrorResponse("UNAUTHORIZED", message), 401)
  }
}

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono<AuthBindings>()

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

    PluginHeartbeatRequestSchema.parse(body)
    context.get("pluginAuth")
    return context.json({ ok: true })
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
