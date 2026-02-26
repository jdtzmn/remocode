import { describe, expect, it } from "vitest"
import type { HistogramSnapshot } from "./metrics"
import { createMetricsRegistry } from "./metrics"

// Helper to access a Record<string, V> by string key without triggering
// biome's useLiteralKeys rule (which fires when the key is a valid identifier).
function get<V>(record: Record<string, V>, key: string): V | undefined {
  return record[key as keyof typeof record] as V | undefined
}

describe("MetricsRegistry", () => {
  it("starts with zeroed counters", () => {
    const reg = createMetricsRegistry()
    const snap = reg.snapshot()
    expect(snap.events_ingested_total).toEqual({})
    expect(snap.events_deduped_total).toBe(0)
    expect(snap.socket_connected_users).toBe(0)
    expect(snap.socket_connected_devices).toBe(0)
    expect(snap.relay_total).toEqual({})
    expect(snap.notifications_total).toEqual({})
    expect(snap.fetch_duration_ms).toEqual({})
    expect(snap.projection_update_duration_ms).toEqual({})
  })

  describe("recordEventIngested", () => {
    it("increments counter per event type", () => {
      const reg = createMetricsRegistry()
      reg.recordEventIngested("permission.asked")
      reg.recordEventIngested("permission.asked")
      reg.recordEventIngested("session.created")
      const ingested = reg.snapshot().events_ingested_total
      // Keys contain dots — not valid identifiers, bracket notation is required.
      expect(ingested["permission.asked"]).toBe(2)
      expect(ingested["session.created"]).toBe(1)
    })
  })

  describe("recordEventDeduped", () => {
    it("increments the deduped counter", () => {
      const reg = createMetricsRegistry()
      reg.recordEventDeduped()
      reg.recordEventDeduped()
      expect(reg.snapshot().events_deduped_total).toBe(2)
    })
  })

  describe("recordProjectionUpdate", () => {
    it("records session and attention latency observations", () => {
      const reg = createMetricsRegistry()
      reg.recordProjectionUpdate("session", 10)
      reg.recordProjectionUpdate("session", 20)
      reg.recordProjectionUpdate("attention", 5)
      const projSnaps = reg.snapshot().projection_update_duration_ms
      const sessionSnap = get<HistogramSnapshot>(projSnaps, "session")
      expect(sessionSnap).toBeDefined()
      expect(sessionSnap?.count).toBe(2)
      expect(sessionSnap?.sum).toBe(30)
      expect(sessionSnap?.min).toBe(10)
      expect(sessionSnap?.max).toBe(20)
      expect(typeof sessionSnap?.mean).toBe("number")
      const attentionSnap = get<HistogramSnapshot>(projSnaps, "attention")
      expect(attentionSnap?.count).toBe(1)
    })
  })

  describe("setSocketConnectedUsers / setSocketConnectedDevices", () => {
    it("updates gauge values", () => {
      const reg = createMetricsRegistry()
      reg.setSocketConnectedUsers(5)
      reg.setSocketConnectedDevices(3)
      expect(reg.snapshot().socket_connected_users).toBe(5)
      expect(reg.snapshot().socket_connected_devices).toBe(3)
      reg.setSocketConnectedUsers(2)
      expect(reg.snapshot().socket_connected_users).toBe(2)
    })
  })

  describe("recordRelay", () => {
    it("increments relay counters per result label", () => {
      const reg = createMetricsRegistry()
      reg.recordRelay("success")
      reg.recordRelay("success")
      reg.recordRelay("offline")
      reg.recordRelay("timeout")
      const relayTotal = reg.snapshot().relay_total
      expect(get<number>(relayTotal, "success")).toBe(2)
      expect(get<number>(relayTotal, "offline")).toBe(1)
      expect(get<number>(relayTotal, "timeout")).toBe(1)
    })
  })

  describe("recordNotification", () => {
    it("increments notification counters per decision", () => {
      const reg = createMetricsRegistry()
      reg.recordNotification("sent")
      reg.recordNotification("suppressed")
      reg.recordNotification("suppressed")
      const notifTotal = reg.snapshot().notifications_total
      expect(get<number>(notifTotal, "sent")).toBe(1)
      expect(get<number>(notifTotal, "suppressed")).toBe(2)
    })
  })

  describe("recordFetchDuration", () => {
    it("records p95/p99 latency per route", () => {
      const reg = createMetricsRegistry()
      // Observe 100 values 1..100ms for sessions.open
      for (let i = 1; i <= 100; i++) {
        reg.recordFetchDuration("sessions.open", i)
      }
      const fetchSnaps = reg.snapshot().fetch_duration_ms
      // "sessions.open" contains a dot — bracket notation required.
      const routeSnap = fetchSnaps["sessions.open"]
      expect(routeSnap.count).toBe(100)
      expect(routeSnap.min).toBe(1)
      expect(routeSnap.max).toBe(100)
      // p95 of 1..100 should be ~95
      expect(routeSnap.p95).toBeGreaterThanOrEqual(94)
      expect(routeSnap.p95).toBeLessThanOrEqual(96)
      // p99 of 1..100 should be ~99
      expect(routeSnap.p99).toBeGreaterThanOrEqual(98)
      expect(routeSnap.p99).toBeLessThanOrEqual(100)
      expect(routeSnap.mean).toBeCloseTo(50.5, 0)
    })

    it("returns undefined for route with no observations", () => {
      const reg = createMetricsRegistry()
      const fetchSnaps = reg.snapshot().fetch_duration_ms
      expect(fetchSnaps["requests.open"]).toBeUndefined()
    })
  })

  describe("histogram snapshot for empty histogram", () => {
    it("returns undefined for label not yet observed", () => {
      const reg = createMetricsRegistry()
      // Record a projection update only for "session" to get an entry,
      // but nothing for "attention" — snapshot should be absent.
      reg.recordProjectionUpdate("session", 5)
      const projSnaps = reg.snapshot().projection_update_duration_ms
      expect(get<HistogramSnapshot>(projSnaps, "attention")).toBeUndefined()
    })
  })

  describe("reset", () => {
    it("clears all metrics back to zero", () => {
      const reg = createMetricsRegistry()
      reg.recordEventIngested("session.created")
      reg.recordEventDeduped()
      reg.setSocketConnectedUsers(10)
      reg.recordRelay("success")
      reg.recordNotification("sent")
      reg.recordFetchDuration("sessions.open", 42)
      reg.reset()
      const snap = reg.snapshot()
      expect(snap.events_ingested_total).toEqual({})
      expect(snap.events_deduped_total).toBe(0)
      expect(snap.socket_connected_users).toBe(0)
      expect(snap.relay_total).toEqual({})
      expect(snap.notifications_total).toEqual({})
      expect(snap.fetch_duration_ms).toEqual({})
    })
  })

  describe("globalMetrics singleton", () => {
    it("is exported and has the expected shape", async () => {
      const { globalMetrics } = await import("./metrics")
      expect(typeof globalMetrics.recordEventIngested).toBe("function")
      expect(typeof globalMetrics.snapshot).toBe("function")
    })
  })
})
