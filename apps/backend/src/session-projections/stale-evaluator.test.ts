import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { STALE_THRESHOLD_MS, createStaleEvaluatorJob } from "./stale-evaluator"

describe("createStaleEvaluatorJob", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("run()", () => {
    it("calls markStaleSessions with staleBeforeDate = now - STALE_THRESHOLD_MS", async () => {
      const now = new Date("2026-02-22T12:00:00.000Z")
      vi.setSystemTime(now)

      const captured: { date: Date | null } = { date: null }
      const job = createStaleEvaluatorJob({
        markStaleSessions: async (date) => {
          captured.date = date
          return 0
        },
      })

      await job.run()

      expect(captured.date).not.toBeNull()
      expect(captured.date?.getTime()).toBe(now.getTime() - STALE_THRESHOLD_MS)
    })

    it("returns markedStale count from the store", async () => {
      const job = createStaleEvaluatorJob({
        markStaleSessions: async () => 5,
      })

      const result = await job.run()
      expect(result.markedStale).toBe(5)
    })

    it("returns 0 when no sessions are stale", async () => {
      const job = createStaleEvaluatorJob({
        markStaleSessions: async () => 0,
      })

      const result = await job.run()
      expect(result.markedStale).toBe(0)
    })
  })

  describe("start() / stop()", () => {
    it("calls markStaleSessions on each interval tick", async () => {
      let callCount = 0
      const job = createStaleEvaluatorJob({
        markStaleSessions: async () => {
          callCount++
          return 0
        },
      })

      const stop = job.start(1000)

      // Advance 3 ticks
      await vi.advanceTimersByTimeAsync(3500)

      expect(callCount).toBe(3)

      stop()
    })

    it("stop() prevents further calls", async () => {
      let callCount = 0
      const job = createStaleEvaluatorJob({
        markStaleSessions: async () => {
          callCount++
          return 0
        },
      })

      const stop = job.start(1000)

      await vi.advanceTimersByTimeAsync(1500)
      expect(callCount).toBe(1)

      stop()

      await vi.advanceTimersByTimeAsync(5000)
      // Should not have increased after stop
      expect(callCount).toBe(1)
    })

    it("does not fire immediately on start (only on interval)", async () => {
      let callCount = 0
      const job = createStaleEvaluatorJob({
        markStaleSessions: async () => {
          callCount++
          return 0
        },
      })

      const stop = job.start(1000)

      // Before first tick - should not have fired yet
      await vi.advanceTimersByTimeAsync(500)
      expect(callCount).toBe(0)

      stop()
    })
  })
})
