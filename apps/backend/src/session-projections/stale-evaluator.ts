/**
 * Stale session evaluator job.
 *
 * Spec §10.2:
 *   - stale threshold: 60 seconds (no heartbeat/status/event)
 *   - visibility grace: 10 minutes (handled in sessions/runtime.ts query)
 *
 * This evaluator periodically marks sessions as stale when the time since
 * max(last_status_at, last_heartbeat_at, last_event_at) exceeds the stale
 * threshold.
 */

export const STALE_THRESHOLD_MS = 60 * 1000 // 60 seconds

export type StaleEvaluatorStore = {
  /**
   * Mark open sessions as stale when their last activity timestamp is older
   * than `staleBeforeDate`. Returns the number of sessions updated.
   */
  markStaleSessions: (staleBeforeDate: Date) => Promise<number>
}

export type StaleEvaluatorJob = {
  /** Run one evaluation pass synchronously. */
  run: () => Promise<{ markedStale: number }>
  /** Start the periodic background interval. Returns a cleanup function. */
  start: (intervalMs?: number) => () => void
}

export const STALE_EVALUATOR_INTERVAL_MS = 30 * 1000 // run every 30s (half the stale threshold)

export function createStaleEvaluatorJob(store: StaleEvaluatorStore): StaleEvaluatorJob {
  const run = async (): Promise<{ markedStale: number }> => {
    const staleBeforeDate = new Date(Date.now() - STALE_THRESHOLD_MS)
    const markedStale = await store.markStaleSessions(staleBeforeDate)
    return { markedStale }
  }

  const start = (intervalMs = STALE_EVALUATOR_INTERVAL_MS): (() => void) => {
    const timer = setInterval(() => {
      run().catch((err) => {
        console.error("[stale-evaluator] error during evaluation", err)
      })
    }, intervalMs)

    // Node.js: don't block process exit on this timer
    if (timer.unref) {
      timer.unref()
    }

    return () => clearInterval(timer)
  }

  return { run, start }
}
