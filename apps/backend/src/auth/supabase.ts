import { createRemoteJWKSet, jwtVerify } from "jose"

import { ApiHttpError } from "../http/errors"
import type { AppAuthContext } from "./types"

type UserResolver = (supabaseUserId: string) => Promise<string>

export type SupabaseJwtVerifier = (token: string) => Promise<AppAuthContext>

export function createSupabaseJwtVerifier(options: {
  issuer: string
  audience: string
  jwksUrl: string
  resolveUserId: UserResolver
}): SupabaseJwtVerifier {
  const jwks = createRemoteJWKSet(new URL(options.jwksUrl))

  return async (token) => {
    let payload: Record<string, unknown>

    try {
      const verified = await jwtVerify(token, jwks, {
        issuer: options.issuer,
        audience: options.audience,
      })
      payload = verified.payload
    } catch {
      throw new ApiHttpError("UNAUTHORIZED", {
        message: "Invalid access token",
      })
    }

    const subject = payload.sub

    if (typeof subject !== "string" || subject.length === 0) {
      throw new ApiHttpError("UNAUTHORIZED", {
        message: "Access token subject missing",
      })
    }

    const userId = await options.resolveUserId(subject)

    return {
      userId,
      supabaseUserId: subject,
      claims: payload,
    }
  }
}
