import { and, desc, eq, isNull, or, sql } from "drizzle-orm"

import { db } from "../db"
import { deviceActivity, devices, sessionProjections } from "../db/schema"
import { createSessionsOpenService } from "./service"

// Sessions are visible if open, or stale within the 10-minute visibility grace window
const STALE_VISIBILITY_GRACE_MS = 10 * 60 * 1000

export const runtimeSessionsOpenService = createSessionsOpenService({
  getOpenSessions: async ({ userId }) => {
    const graceThreshold = new Date(Date.now() - STALE_VISIBILITY_GRACE_MS)

    const rows = await db
      .select({
        sessionId: sessionProjections.sessionId,
        title: sessionProjections.title,
        sessionState: sessionProjections.sessionState,
        requiresAttention: sessionProjections.requiresAttention,
        attentionCount: sessionProjections.attentionCount,
        lastEventAt: sessionProjections.lastEventAt,
        lastAttentionAt: sessionProjections.lastAttentionAt,
        isStale: sessionProjections.isStale,
        deviceId: devices.id,
        deviceName: devices.name,
        devicePlatform: devices.platform,
        deviceLastSeenAt: devices.lastSeenAt,
        activityIsActive: deviceActivity.isActive,
        activityIdleSeconds: deviceActivity.idleSeconds,
        activitySampledAt: deviceActivity.sampledAt,
      })
      .from(sessionProjections)
      .innerJoin(devices, eq(sessionProjections.deviceId, devices.id))
      .leftJoin(deviceActivity, eq(sessionProjections.deviceId, deviceActivity.deviceId))
      .where(
        and(
          eq(sessionProjections.userId, userId),
          eq(sessionProjections.isOpen, true),
          // Visibility: is_open AND (not stale OR within grace window)
          or(
            eq(sessionProjections.isStale, false),
            // stale but within grace: updatedAt after grace threshold
            and(
              eq(sessionProjections.isStale, true),
              sql`${sessionProjections.updatedAt} >= ${graceThreshold}`,
            ),
          ),
        ),
      )
      .orderBy(
        desc(sessionProjections.requiresAttention),
        desc(sessionProjections.lastAttentionAt),
        desc(sessionProjections.lastEventAt),
      )

    return rows.map((row) => ({
      sessionId: row.sessionId,
      title: row.title,
      sessionState: row.sessionState,
      requiresAttention: row.requiresAttention,
      attentionCount: row.attentionCount,
      lastEventAt: row.lastEventAt,
      lastAttentionAt: row.lastAttentionAt ?? null,
      isStale: row.isStale,
      deviceId: row.deviceId,
      deviceName: row.deviceName ?? null,
      devicePlatform: row.devicePlatform ?? null,
      deviceLastSeenAt: row.deviceLastSeenAt ?? null,
      activityIsActive: row.activityIsActive ?? null,
      activityIdleSeconds: row.activityIdleSeconds ?? null,
      activitySampledAt: row.activitySampledAt ?? null,
    }))
  },
})
