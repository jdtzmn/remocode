import type {
  DeviceActivitySummarySchema,
  DeviceGroupSchema,
  SessionSummarySchema,
  SessionsOpenResponseSchema,
} from "@remocode/contracts"
import type { z } from "zod"

type SessionSummary = z.infer<typeof SessionSummarySchema>
type DeviceGroup = z.infer<typeof DeviceGroupSchema>
type DeviceActivitySummary = z.infer<typeof DeviceActivitySummarySchema>
export type SessionsOpenResponse = z.infer<typeof SessionsOpenResponseSchema>

export type OpenSessionRow = {
  sessionId: string
  title: string | null
  sessionState: string
  requiresAttention: boolean
  attentionCount: number
  lastEventAt: Date
  lastAttentionAt: Date | null
  isStale: boolean
  deviceId: string
  deviceName: string | null
  devicePlatform: string | null
  deviceLastSeenAt: Date | null
  activityIsActive: boolean | null
  activityIdleSeconds: number | null
  activitySampledAt: Date | null
}

export type SessionsOpenStore = {
  getOpenSessions: (args: { userId: string }) => Promise<OpenSessionRow[]>
}

export type SessionsOpenService = (args: { userId: string }) => Promise<SessionsOpenResponse>

function toSessionSummary(row: OpenSessionRow): SessionSummary {
  return {
    session_id: row.sessionId,
    title: row.title ?? row.sessionId,
    state: row.sessionState as SessionSummary["state"],
    requires_attention: row.requiresAttention,
    attention_count: row.attentionCount,
    last_event_at: row.lastEventAt.toISOString(),
    last_attention_at: row.lastAttentionAt ? row.lastAttentionAt.toISOString() : null,
    is_stale: row.isStale,
  }
}

function compareSessionRows(a: OpenSessionRow, b: OpenSessionRow): number {
  // requires_attention DESC
  if (a.requiresAttention !== b.requiresAttention) {
    return a.requiresAttention ? -1 : 1
  }

  // last_attention_at DESC NULLS LAST
  if (a.lastAttentionAt !== null && b.lastAttentionAt !== null) {
    return b.lastAttentionAt.getTime() - a.lastAttentionAt.getTime()
  }
  if (a.lastAttentionAt !== null) return -1
  if (b.lastAttentionAt !== null) return 1

  // last_event_at DESC
  return b.lastEventAt.getTime() - a.lastEventAt.getTime()
}

export function createSessionsOpenService(store: SessionsOpenStore): SessionsOpenService {
  return async ({ userId }) => {
    const rows = await store.getOpenSessions({ userId })

    // Group sessions by device
    const deviceMap = new Map<string, { rows: OpenSessionRow[] }>()

    for (const row of rows) {
      const existing = deviceMap.get(row.deviceId)
      if (existing) {
        existing.rows.push(row)
      } else {
        deviceMap.set(row.deviceId, { rows: [row] })
      }
    }

    // Build device groups with sorted sessions
    const groups: Array<{ topRow: OpenSessionRow; group: DeviceGroup }> = []

    for (const [, { rows: deviceRows }] of deviceMap) {
      // Sort sessions within group
      const sortedRows = [...deviceRows].sort(compareSessionRows)
      const topRow = sortedRows[0]

      const firstRow = deviceRows[0]

      let activity: DeviceActivitySummary | null = null
      if (firstRow.activitySampledAt !== null) {
        activity = {
          is_active: firstRow.activityIsActive,
          idle_seconds: firstRow.activityIdleSeconds,
          sampled_at: firstRow.activitySampledAt.toISOString(),
        }
      }

      const group: DeviceGroup = {
        device: {
          id: firstRow.deviceId,
          name: firstRow.deviceName,
          platform: firstRow.devicePlatform,
          last_seen_at: firstRow.deviceLastSeenAt ? firstRow.deviceLastSeenAt.toISOString() : null,
          activity,
        },
        sessions: sortedRows.map(toSessionSummary),
      }

      groups.push({ topRow, group })
    }

    // Sort device groups by their top session using same ordering key
    groups.sort((a, b) => compareSessionRows(a.topRow, b.topRow))

    return {
      groups: groups.map(({ group }) => group),
    }
  }
}
