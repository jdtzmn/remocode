/**
 * In-process metrics registry (§18.2).
 *
 * Tracks:
 *   - events_ingested_total{event_type}   — counter per event type
 *   - events_deduped_total                — counter
 *   - projection_update_duration_ms       — histogram (session + attention projection latency)
 *   - socket_connected_users              — gauge
 *   - socket_connected_devices            — gauge
 *   - relay_total{result}                 — counter (success | timeout | execution_failed | offline | error)
 *   - notifications_total{decision}       — counter (sent | suppressed)
 *   - fetch_duration_ms{route}            — histogram (app GET endpoint p95 latency)
 *
 * All metrics are keyed to a singleton MetricsRegistry instance that is shared
 * across the process via `globalMetrics`.  Tests can create isolated instances
 * via `createMetricsRegistry()`.
 *
 * The `/metrics` endpoint exposes a JSON snapshot of all current values.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetricCounter = {
  readonly name: string
  inc(amount?: number): void
  value(): number
}

export type MetricGauge = {
  readonly name: string
  set(value: number): void
  inc(amount?: number): void
  dec(amount?: number): void
  value(): number
}

/** Rolling histogram that tracks count, sum, min, max, and approximate p95. */
export type MetricHistogram = {
  readonly name: string
  /** Record an observation (in milliseconds). */
  observe(value: number): void
  snapshot(): HistogramSnapshot
}

export type HistogramSnapshot = {
  count: number
  sum: number
  min: number | null
  max: number | null
  /** Approximate p95 computed over a sliding window of the last 1000 observations. */
  p95: number | null
  /** Approximate p99 computed over a sliding window of the last 1000 observations. */
  p99: number | null
  mean: number | null
}

/** A labelled family of counters — one counter per unique label value. */
export type CounterFamily = {
  readonly name: string
  inc(label: string, amount?: number): void
  values(): Record<string, number>
}

/** A labelled family of histograms — one histogram per unique label value. */
export type HistogramFamily = {
  readonly name: string
  observe(label: string, value: number): void
  snapshots(): Record<string, HistogramSnapshot>
}

export type MetricsSnapshot = {
  events_ingested_total: Record<string, number>
  events_deduped_total: number
  projection_update_duration_ms: Record<string, HistogramSnapshot>
  socket_connected_users: number
  socket_connected_devices: number
  relay_total: Record<string, number>
  notifications_total: Record<string, number>
  fetch_duration_ms: Record<string, HistogramSnapshot>
}

export type MetricsRegistry = {
  /** Increment the ingested-events counter for the given event type. */
  recordEventIngested(eventType: string): void
  /** Increment the deduped-events counter. */
  recordEventDeduped(): void
  /**
   * Record a projection update duration (ms).
   * @param kind — "session" | "attention"
   */
  recordProjectionUpdate(kind: "session" | "attention", durationMs: number): void
  /** Set the number of currently connected app users. */
  setSocketConnectedUsers(count: number): void
  /** Set the number of currently connected plugin devices. */
  setSocketConnectedDevices(count: number): void
  /**
   * Record a relay attempt result.
   * @param result — "success" | "offline" | "timeout" | "execution_failed" | "error"
   */
  recordRelay(result: "success" | "offline" | "timeout" | "execution_failed" | "error"): void
  /**
   * Record a notification decision or outcome.
   * @param decision — "sent" | "suppressed" | "push_failure"
   */
  recordNotification(decision: "sent" | "suppressed" | "push_failure"): void
  /**
   * Record an app fetch duration (ms) for the named route.
   * @param route — short human-readable identifier e.g. "sessions.open"
   */
  recordFetchDuration(route: string, durationMs: number): void
  /** Return a point-in-time snapshot of all metric values. */
  snapshot(): MetricsSnapshot
  /** Reset all metrics (useful in tests). */
  reset(): void
}

// ─── Implementations ──────────────────────────────────────────────────────────

const WINDOW_SIZE = 1000

function createCounter(name: string): MetricCounter {
  let _value = 0
  return {
    name,
    inc(amount = 1) {
      _value += amount
    },
    value() {
      return _value
    },
  }
}

function createGauge(name: string): MetricGauge {
  let _value = 0
  return {
    name,
    set(value) {
      _value = value
    },
    inc(amount = 1) {
      _value += amount
    },
    dec(amount = 1) {
      _value -= amount
    },
    value() {
      return _value
    },
  }
}

function createHistogram(name: string): MetricHistogram {
  let count = 0
  let sum = 0
  let min: number | null = null
  let max: number | null = null
  // Sliding window for percentile estimation
  const window: number[] = []

  return {
    name,
    observe(value) {
      count += 1
      sum += value
      if (min === null || value < min) min = value
      if (max === null || value > max) max = value

      window.push(value)
      if (window.length > WINDOW_SIZE) {
        window.shift()
      }
    },
    snapshot() {
      if (count === 0) {
        return { count: 0, sum: 0, min: null, max: null, p95: null, p99: null, mean: null }
      }

      const sorted = [...window].sort((a, b) => a - b)
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? null
      const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? null

      return {
        count,
        sum,
        min,
        max,
        p95,
        p99,
        mean: sum / count,
      }
    },
  }
}

function createCounterFamily(name: string): CounterFamily {
  const counters = new Map<string, MetricCounter>()

  function getOrCreate(label: string): MetricCounter {
    let c = counters.get(label)
    if (!c) {
      c = createCounter(`${name}{${label}}`)
      counters.set(label, c)
    }
    return c
  }

  return {
    name,
    inc(label, amount = 1) {
      getOrCreate(label).inc(amount)
    },
    values() {
      const result: Record<string, number> = {}
      for (const [label, c] of counters) {
        result[label] = c.value()
      }
      return result
    },
  }
}

function createHistogramFamily(name: string): HistogramFamily {
  const histograms = new Map<string, MetricHistogram>()

  function getOrCreate(label: string): MetricHistogram {
    let h = histograms.get(label)
    if (!h) {
      h = createHistogram(`${name}{${label}}`)
      histograms.set(label, h)
    }
    return h
  }

  return {
    name,
    observe(label, value) {
      getOrCreate(label).observe(value)
    },
    snapshots() {
      const result: Record<string, HistogramSnapshot> = {}
      for (const [label, h] of histograms) {
        result[label] = h.snapshot()
      }
      return result
    },
  }
}

// ─── Registry factory ─────────────────────────────────────────────────────────

export function createMetricsRegistry(): MetricsRegistry {
  let eventsIngested = createCounterFamily("events_ingested_total")
  let eventsDeduped = createCounter("events_deduped_total")
  let projectionUpdateDuration = createHistogramFamily("projection_update_duration_ms")
  let socketUsers = createGauge("socket_connected_users")
  let socketDevices = createGauge("socket_connected_devices")
  let relayTotal = createCounterFamily("relay_total")
  let notificationsTotal = createCounterFamily("notifications_total")
  let fetchDuration = createHistogramFamily("fetch_duration_ms")

  return {
    recordEventIngested(eventType) {
      eventsIngested.inc(eventType)
    },
    recordEventDeduped() {
      eventsDeduped.inc()
    },
    recordProjectionUpdate(kind, durationMs) {
      projectionUpdateDuration.observe(kind, durationMs)
    },
    setSocketConnectedUsers(count) {
      socketUsers.set(count)
    },
    setSocketConnectedDevices(count) {
      socketDevices.set(count)
    },
    recordRelay(result) {
      relayTotal.inc(result)
    },
    recordNotification(decision) {
      notificationsTotal.inc(decision)
    },
    recordFetchDuration(route, durationMs) {
      fetchDuration.observe(route, durationMs)
    },
    snapshot() {
      return {
        events_ingested_total: eventsIngested.values(),
        events_deduped_total: eventsDeduped.value(),
        projection_update_duration_ms: projectionUpdateDuration.snapshots(),
        socket_connected_users: socketUsers.value(),
        socket_connected_devices: socketDevices.value(),
        relay_total: relayTotal.values(),
        notifications_total: notificationsTotal.values(),
        fetch_duration_ms: fetchDuration.snapshots(),
      }
    },
    reset() {
      eventsIngested = createCounterFamily("events_ingested_total")
      eventsDeduped = createCounter("events_deduped_total")
      projectionUpdateDuration = createHistogramFamily("projection_update_duration_ms")
      socketUsers = createGauge("socket_connected_users")
      socketDevices = createGauge("socket_connected_devices")
      relayTotal = createCounterFamily("relay_total")
      notificationsTotal = createCounterFamily("notifications_total")
      fetchDuration = createHistogramFamily("fetch_duration_ms")
    },
  }
}

/** Global singleton registry shared across the process. */
export const globalMetrics: MetricsRegistry = createMetricsRegistry()
