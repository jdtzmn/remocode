import { and, eq, isNull } from "drizzle-orm"

import { db } from "../db"
import { personalAccessTokens } from "../db/schema"
import {
  type PatsStore,
  createPatCreateService,
  createPatListService,
  createPatRevokeService,
} from "./service"

const patsStore: PatsStore = {
  createPat: async ({ userId, label, tokenPrefix, secretHash, createdAt }) => {
    const rows = await db
      .insert(personalAccessTokens)
      .values({
        userId,
        label,
        tokenPrefix,
        secretHash,
        createdAt,
      })
      .returning({
        id: personalAccessTokens.id,
        userId: personalAccessTokens.userId,
        label: personalAccessTokens.label,
        tokenPrefix: personalAccessTokens.tokenPrefix,
        createdAt: personalAccessTokens.createdAt,
        lastUsedAt: personalAccessTokens.lastUsedAt,
        revokedAt: personalAccessTokens.revokedAt,
      })

    return rows[0]
  },

  listPats: async ({ userId }) => {
    const rows = await db
      .select({
        id: personalAccessTokens.id,
        userId: personalAccessTokens.userId,
        label: personalAccessTokens.label,
        tokenPrefix: personalAccessTokens.tokenPrefix,
        createdAt: personalAccessTokens.createdAt,
        lastUsedAt: personalAccessTokens.lastUsedAt,
        revokedAt: personalAccessTokens.revokedAt,
      })
      .from(personalAccessTokens)
      .where(and(eq(personalAccessTokens.userId, userId), isNull(personalAccessTokens.revokedAt)))
      .orderBy(personalAccessTokens.createdAt)

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      label: row.label,
      tokenPrefix: row.tokenPrefix,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt ?? null,
      revokedAt: row.revokedAt ?? null,
    }))
  },

  revokePat: async ({ patId, userId, revokedAt }) => {
    const rows = await db
      .update(personalAccessTokens)
      .set({ revokedAt })
      .where(
        and(
          eq(personalAccessTokens.id, patId),
          eq(personalAccessTokens.userId, userId),
          isNull(personalAccessTokens.revokedAt),
        ),
      )
      .returning({
        id: personalAccessTokens.id,
        userId: personalAccessTokens.userId,
        label: personalAccessTokens.label,
        tokenPrefix: personalAccessTokens.tokenPrefix,
        createdAt: personalAccessTokens.createdAt,
        lastUsedAt: personalAccessTokens.lastUsedAt,
        revokedAt: personalAccessTokens.revokedAt,
      })

    if (rows.length === 0) {
      return null
    }

    const row = rows[0]
    return {
      id: row.id,
      userId: row.userId,
      label: row.label,
      tokenPrefix: row.tokenPrefix,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt ?? null,
      revokedAt: row.revokedAt ?? null,
    }
  },
}

export const runtimePatListService = createPatListService(patsStore)
export const runtimePatRevokeService = createPatRevokeService(patsStore)

export function createRuntimePatCreateService(pepper: string) {
  return createPatCreateService(patsStore, pepper)
}
