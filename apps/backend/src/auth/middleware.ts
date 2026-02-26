import type { MiddlewareHandler } from "hono"

import { ApiHttpError } from "../http/errors"
import { readBearerToken } from "./headers"
import type { SupabaseJwtVerifier } from "./supabase"
import type { AuthBindings, PluginAuthContext } from "./types"

type PluginAuthenticator = (token: string) => Promise<PluginAuthContext>

export function createAppAuthMiddleware(options: {
  verifyToken: SupabaseJwtVerifier
}): MiddlewareHandler<AuthBindings> {
  return async (context, next) => {
    const token = readBearerToken(context.req.header("authorization"))

    if (!token) {
      throw new ApiHttpError("UNAUTHORIZED", {
        message: "Missing bearer token",
      })
    }

    context.set("appAuth", await options.verifyToken(token))
    await next()
  }
}

export function createPluginAuthMiddleware(options: {
  authenticate: PluginAuthenticator
}): MiddlewareHandler<AuthBindings> {
  return async (context, next) => {
    const token = readBearerToken(context.req.header("authorization"))

    if (!token) {
      throw new ApiHttpError("UNAUTHORIZED", {
        message: "Missing bearer token",
      })
    }

    context.set("pluginAuth", await options.authenticate(token))
    await next()
  }
}
