import { and, count, eq } from "drizzle-orm"

import { db } from "../db"
import { attentionRequests, sessionProjections } from "../db/schema"
import { createAttentionRequestReducer } from "./reducer"

export const runtimeAttentionRequestReducer = createAttentionRequestReducer({
  upsertRequest: async ({ requestId, sessionId, userId, deviceId, kind, payload, openedAt }) => {
    await db
      .insert(attentionRequests)
      .values({
        requestId,
        sessionId,
        userId,
        deviceId,
        kind,
        status: "open",
        payload,
        openedAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: attentionRequests.requestId,
        set: {
          sessionId,
          userId,
          deviceId,
          kind,
          status: "open",
          payload,
          openedAt,
          updatedAt: new Date(),
        },
      })
  },

  closeRequest: async ({ requestId, userId, status, resolvedAt }) => {
    await db
      .update(attentionRequests)
      .set({ status, resolvedAt, updatedAt: new Date() })
      .where(and(eq(attentionRequests.requestId, requestId), eq(attentionRequests.userId, userId)))
  },

  countOpenRequests: async ({ sessionId, userId }) => {
    const result = await db
      .select({ count: count() })
      .from(attentionRequests)
      .where(
        and(
          eq(attentionRequests.sessionId, sessionId),
          eq(attentionRequests.userId, userId),
          eq(attentionRequests.status, "open"),
        ),
      )

    return result[0]?.count ?? 0
  },

  updateSessionAttention: async ({
    sessionId,
    userId,
    attentionCount,
    requiresAttention,
    lastAttentionAt,
  }) => {
    const set: Record<string, unknown> = {
      attentionCount,
      requiresAttention,
      updatedAt: new Date(),
    }

    if (lastAttentionAt !== null) {
      set.lastAttentionAt = lastAttentionAt
    }

    await db
      .update(sessionProjections)
      .set(set)
      .where(
        and(eq(sessionProjections.sessionId, sessionId), eq(sessionProjections.userId, userId)),
      )
  },
})
