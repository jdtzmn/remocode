import { Hono } from "hono"

import { toApiErrorResponse, toApiHttpError } from "./http/errors"

export function createApp() {
  const app = new Hono()

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

  return app
}
