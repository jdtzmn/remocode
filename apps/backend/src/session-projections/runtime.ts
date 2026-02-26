import { and, eq, inArray } from "drizzle-orm"

import { db } from "../db"
import { sessionProjections } from "../db/schema"
import { createSessionProjectionReducer } from "./reducer"

export const runtimeSessionProjectionReducer = createSessionProjectionReducer({
  upsertSession: async ({
    sessionId,
    userId,
    deviceId,
    title,
    directory,
    sessionState,
    isOpen,
    lastEventAt,
  }) => {
    await db
      .insert(sessionProjections)
      .values({
        sessionId,
        userId,
        deviceId,
        title: title ?? null,
        directory: directory ?? null,
        sessionState: sessionState ?? "unknown",
        isOpen: isOpen ?? true,
        lastEventAt: lastEventAt ?? new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: sessionProjections.sessionId,
        set: {
          userId,
          deviceId,
          title: title ?? null,
          directory: directory ?? null,
          sessionState: sessionState ?? "unknown",
          isOpen: isOpen ?? true,
          lastEventAt: lastEventAt ?? new Date(),
          updatedAt: new Date(),
        },
      })
  },

  updateSession: async (sessionId, userId, update) => {
    const set: Record<string, unknown> = { updatedAt: new Date() }

    if (update.title !== undefined) set.title = update.title
    if (update.directory !== undefined) set.directory = update.directory
    if (update.sessionState !== undefined) set.sessionState = update.sessionState
    if (update.isOpen !== undefined) set.isOpen = update.isOpen
    if (update.requiresAttention !== undefined) set.requiresAttention = update.requiresAttention
    if (update.lastEventAt !== undefined) set.lastEventAt = update.lastEventAt
    if (update.lastStatusAt !== undefined) set.lastStatusAt = update.lastStatusAt
    if (update.lastHeartbeatAt !== undefined) set.lastHeartbeatAt = update.lastHeartbeatAt

    await db
      .update(sessionProjections)
      .set(set)
      .where(
        and(eq(sessionProjections.sessionId, sessionId), eq(sessionProjections.userId, userId)),
      )
  },

  updateSessionsHeartbeat: async (sessionIds, userId, lastHeartbeatAt) => {
    await db
      .update(sessionProjections)
      .set({ lastHeartbeatAt, updatedAt: new Date() })
      .where(
        and(
          inArray(sessionProjections.sessionId, sessionIds),
          eq(sessionProjections.userId, userId),
        ),
      )
  },
})
