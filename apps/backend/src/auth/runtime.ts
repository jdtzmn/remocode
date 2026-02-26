import { eq } from "drizzle-orm"

import { type AppEnv, requireAuthEnv } from "../config/env"
import { db } from "../db"
import { personalAccessTokens, users } from "../db/schema"
import { createAppAuthMiddleware, createPluginAuthMiddleware } from "./middleware"
import { createPatAuthenticator } from "./pat"
import { createSupabaseJwtVerifier } from "./supabase"

async function resolveOrCreateUserId(supabaseUserId: string) {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.supabaseUserId, supabaseUserId))
    .limit(1)

  if (existing.length > 0) {
    return existing[0].id
  }

  const inserted = await db
    .insert(users)
    .values({ supabaseUserId })
    .onConflictDoNothing({ target: users.supabaseUserId })
    .returning({ id: users.id })

  if (inserted.length > 0) {
    return inserted[0].id
  }

  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.supabaseUserId, supabaseUserId))
    .limit(1)

  if (found.length === 0) {
    throw new Error("Unable to resolve user")
  }

  return found[0].id
}

export function createRuntimeSupabaseJwtVerifier(authEnv: {
  SUPABASE_ISSUER: string
  SUPABASE_AUDIENCE: string
  SUPABASE_JWKS_URL: string
}) {
  return createSupabaseJwtVerifier({
    issuer: authEnv.SUPABASE_ISSUER,
    audience: authEnv.SUPABASE_AUDIENCE,
    jwksUrl: authEnv.SUPABASE_JWKS_URL,
    resolveUserId: resolveOrCreateUserId,
  })
}

export function createRuntimePatAuthenticator(authEnv: { PAT_HASH_PEPPER: string }) {
  return createPatAuthenticator({
    pepper: authEnv.PAT_HASH_PEPPER,
    findPatByPrefix: async (tokenPrefix) => {
      const rows = await db
        .select({
          id: personalAccessTokens.id,
          userId: personalAccessTokens.userId,
          tokenPrefix: personalAccessTokens.tokenPrefix,
          secretHash: personalAccessTokens.secretHash,
          revokedAt: personalAccessTokens.revokedAt,
        })
        .from(personalAccessTokens)
        .where(eq(personalAccessTokens.tokenPrefix, tokenPrefix))
        .limit(1)

      return rows[0] ?? null
    },
    markPatUsedAt: async (patId, usedAt) => {
      await db
        .update(personalAccessTokens)
        .set({ lastUsedAt: usedAt })
        .where(eq(personalAccessTokens.id, patId))
    },
  })
}

export function createRuntimeAuthMiddlewares(env: AppEnv) {
  const authEnv = requireAuthEnv(env)

  const verifyToken = createRuntimeSupabaseJwtVerifier(authEnv)
  const authenticate = createRuntimePatAuthenticator(authEnv)

  return {
    appAuthMiddleware: createAppAuthMiddleware({ verifyToken }),
    pluginAuthMiddleware: createPluginAuthMiddleware({ authenticate }),
  }
}
