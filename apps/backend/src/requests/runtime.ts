import { and, desc, eq } from "drizzle-orm"

import { db } from "../db"
import { attentionRequests } from "../db/schema"
import { createRequestsOpenService } from "./service"

export const runtimeRequestsOpenService = createRequestsOpenService({
  getOpenRequests: async ({ userId }) => {
    const rows = await db
      .select({
        requestId: attentionRequests.requestId,
        sessionId: attentionRequests.sessionId,
        deviceId: attentionRequests.deviceId,
        kind: attentionRequests.kind,
        status: attentionRequests.status,
        payload: attentionRequests.payload,
        openedAt: attentionRequests.openedAt,
      })
      .from(attentionRequests)
      .where(and(eq(attentionRequests.userId, userId), eq(attentionRequests.status, "open")))
      .orderBy(desc(attentionRequests.openedAt))

    return rows.map((row) => ({
      requestId: row.requestId,
      sessionId: row.sessionId,
      deviceId: row.deviceId,
      kind: row.kind,
      status: row.status,
      payload: row.payload,
      openedAt: row.openedAt,
    }))
  },
})
