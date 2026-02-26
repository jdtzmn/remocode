import { and, eq, isNull, lt, or, sql } from "drizzle-orm"

import { db } from "../db"
import { sessionProjections } from "../db/schema"
import { createStaleEvaluatorJob } from "./stale-evaluator"

/**
 * Mark open, non-stale sessions as stale when the time since their last
 * activity (max of last_status_at, last_heartbeat_at, last_event_at) exceeds
 * `staleBeforeDate`.
 *
 * SQL logic:
 *   is_open = true AND is_stale = false AND
 *   GREATEST(
 *     COALESCE(last_status_at, '1970-01-01'),
 *     COALESCE(last_heartbeat_at, '1970-01-01'),
 *     last_event_at
 *   ) < staleBeforeDate
 */
async function markStaleSessions(staleBeforeDate: Date): Promise<number> {
  const epoch = new Date(0)

  const lastActivityExpr = sql`GREATEST(
    COALESCE(${sessionProjections.lastStatusAt}, ${epoch.toISOString()}::timestamptz),
    COALESCE(${sessionProjections.lastHeartbeatAt}, ${epoch.toISOString()}::timestamptz),
    ${sessionProjections.lastEventAt}
  )`

  const result = await db
    .update(sessionProjections)
    .set({
      isStale: true,
      staleAt: sql`CASE WHEN ${sessionProjections.staleAt} IS NULL THEN now() ELSE ${sessionProjections.staleAt} END`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessionProjections.isOpen, true),
        eq(sessionProjections.isStale, false),
        lt(lastActivityExpr, staleBeforeDate),
      ),
    )

  return (result as unknown as { rowCount?: number }).rowCount ?? 0
}

export const runtimeStaleEvaluatorJob = createStaleEvaluatorJob({ markStaleSessions })
