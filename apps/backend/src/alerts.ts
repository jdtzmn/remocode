/**
 * Alert engine for the backend (§18.3).
 *
 * Monitors the MetricsRegistry on a configurable polling interval and fires
 * alert callbacks when thresholds are breached.  Each alert transitions
 * between FIRING and RESOLVED states and only notifies the handler on
 * state transitions (not on every poll tick).
 *
 * Supported alert types (§18.3):
 *   1. relay_timeout_rate   — relay_total{timeout} / relay_total{*} > threshold
 *   2. ingest_failure_rate  — ingest errors / ingest attempts > threshold
 *   3. push_send_failure_burst — (not tracked per se; mirrors notification_sent drops)
 *      We derive this from relay execution_failed + error rate as a proxy for
 *      downstream push send failures. Actual push send failure tracking is
 *      done via notification_total{suppressed} deviations in a separate counter
 *      that is incremented by the push sender on hard send failures.
 *   4. plugin_online_drop   — socket_connected_devices drops to 0 (or below
 *      a user-specified floor) after having been > floor
 *
 * Usage:
 *   const alertEngine = createAlertEngine({
 *     metrics: globalMetrics,
 *     onAlert: (alert) => logger.error("ALERT", { ...alert }),
 *   })
 *   alertEngine.start()          // begins polling
 *   alertEngine.stop()           // cancels polling
 *   alertEngine.checkNow()       // synchronous check (useful in tests)
 */

import type { MetricsRegistry, MetricsSnapshot } from "./metrics"

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertName =
  | "relay_timeout_rate"
  | "ingest_failure_rate"
  | "push_send_failure_burst"
  | "plugin_online_drop"

export type AlertState = "firing" | "resolved"

export type AlertEvent = {
  name: AlertName
  state: AlertState
  /** Human-readable description of what triggered (or resolved) the alert. */
  message: string
  /** Point-in-time metric values that caused the state transition. */
  details: Record<string, number>
  /** ISO-8601 timestamp of the transition. */
  firedAt: string
}

export type AlertHandler = (event: AlertEvent) => void

export type AlertEngineOptions = {
  /** Source of truth for all metric values. */
  metrics: MetricsRegistry
  /** Called on every FIRING or RESOLVED state transition. */
  onAlert: AlertHandler
  /** Polling interval in milliseconds (default: 30_000). */
  pollIntervalMs?: number

  // ─── Relay timeout alert ───────────────────────────────────────────────
  /**
   * Minimum number of relay attempts required before the rate is evaluated.
   * Prevents spurious fires on cold start with low sample counts.
   * Default: 10
   */
  relayMinAttempts?: number
  /**
   * Fraction of relay attempts that may be timeouts before alerting (0–1).
   * Default: 0.1 (10 %)
   */
  relayTimeoutRateThreshold?: number

  // ─── Ingest failure alert ──────────────────────────────────────────────
  /**
   * Minimum number of ingest attempts before the rate is evaluated.
   * Default: 10
   */
  ingestMinAttempts?: number
  /**
   * Fraction of ingest events that may be deduped/failed before alerting (0–1).
   * Default: 0.5 (50 %)
   */
  ingestFailureRateThreshold?: number

  // ─── Push send failure burst alert ────────────────────────────────────
  /**
   * Minimum number of push send attempts before the rate is evaluated.
   * Default: 5
   */
  pushMinAttempts?: number
  /**
   * Fraction of push sends that may fail before alerting (0–1).
   * Default: 0.25 (25 %)
   */
  pushFailureRateThreshold?: number

  // ─── Plugin online drop alert ──────────────────────────────────────────
  /**
   * Alert fires when connected device count drops to this value or below
   * after having previously been above it.
   * Default: 0
   */
  pluginOnlineFloor?: number
}

export type AlertEngine = {
  /** Start periodic polling. No-op if already started. */
  start(): void
  /** Stop periodic polling. No-op if already stopped. */
  stop(): void
  /**
   * Run a single synchronous check against the current metric snapshot and
   * fire handlers for any state transitions.  Exposed primarily for tests.
   */
  checkNow(): void
}

// ─── Internal state ───────────────────────────────────────────────────────────

type AlertInternalState = {
  firing: boolean
  /** Snapshot values saved at the time of the last transition check. */
  lastSnapshot: Partial<MetricsSnapshot>
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createAlertEngine(options: AlertEngineOptions): AlertEngine {
  const {
    metrics,
    onAlert,
    pollIntervalMs = 30_000,
    relayMinAttempts = 10,
    relayTimeoutRateThreshold = 0.1,
    ingestMinAttempts = 10,
    ingestFailureRateThreshold = 0.5,
    pushMinAttempts = 5,
    pushFailureRateThreshold = 0.25,
    pluginOnlineFloor = 0,
  } = options

  // Per-alert state tracking (only fire on transitions)
  const state: Record<AlertName, AlertInternalState> = {
    relay_timeout_rate: { firing: false, lastSnapshot: {} },
    ingest_failure_rate: { firing: false, lastSnapshot: {} },
    push_send_failure_burst: { firing: false, lastSnapshot: {} },
    plugin_online_drop: { firing: false, lastSnapshot: {} },
  }

  // Track whether plugin connected devices was above the floor in a previous
  // tick so that we can detect a drop (not just "is zero on startup").
  let pluginDevicesPreviouslyAboveFloor = false

  let timer: ReturnType<typeof setInterval> | null = null

  // ─── Helper to emit a state transition ────────────────────────────────────

  function transition(
    name: AlertName,
    newFiring: boolean,
    message: string,
    details: Record<string, number>,
  ) {
    const current = state[name]
    if (current.firing === newFiring) return // no transition, skip

    current.firing = newFiring
    onAlert({
      name,
      state: newFiring ? "firing" : "resolved",
      message,
      details,
      firedAt: new Date().toISOString(),
    })
  }

  // ─── Individual alert checks ───────────────────────────────────────────────

  function getCounterValue(record: Record<string, number>, key: string): number {
    return (record[key as keyof typeof record] as number | undefined) ?? 0
  }

  function checkRelayTimeoutRate(snap: MetricsSnapshot) {
    const relay = snap.relay_total
    const timeout = getCounterValue(relay, "timeout")
    const success = getCounterValue(relay, "success")
    const offline = getCounterValue(relay, "offline")
    const executionFailed = getCounterValue(relay, "execution_failed")
    const error = getCounterValue(relay, "error")

    const total = timeout + success + offline + executionFailed + error

    if (total < relayMinAttempts) {
      // Not enough data — resolve any existing alert and wait for more samples
      transition(
        "relay_timeout_rate",
        false,
        "Relay timeout rate below minimum sample count — alert cleared",
        { total, timeout },
      )
      return
    }

    const rate = timeout / total
    const firing = rate > relayTimeoutRateThreshold

    transition(
      "relay_timeout_rate",
      firing,
      firing
        ? `Relay timeout rate ${(rate * 100).toFixed(1)}% exceeds threshold ${(relayTimeoutRateThreshold * 100).toFixed(1)}%`
        : `Relay timeout rate ${(rate * 100).toFixed(1)}% is within threshold`,
      { total, timeout, rate_pct: Math.round(rate * 10_000) / 100 },
    )
  }

  function checkIngestFailureRate(snap: MetricsSnapshot) {
    const ingested = Object.values(snap.events_ingested_total).reduce((a, b) => a + b, 0)
    const deduped = snap.events_deduped_total

    const total = ingested + deduped

    if (total < ingestMinAttempts) {
      transition(
        "ingest_failure_rate",
        false,
        "Ingest sample count below minimum — alert cleared",
        { total, deduped },
      )
      return
    }

    const rate = deduped / total
    const firing = rate > ingestFailureRateThreshold

    transition(
      "ingest_failure_rate",
      firing,
      firing
        ? `Ingest dedup/failure rate ${(rate * 100).toFixed(1)}% exceeds threshold ${(ingestFailureRateThreshold * 100).toFixed(1)}%`
        : `Ingest dedup/failure rate ${(rate * 100).toFixed(1)}% is within threshold`,
      { total, deduped, rate_pct: Math.round(rate * 10_000) / 100 },
    )
  }

  function checkPushSendFailureBurst(snap: MetricsSnapshot) {
    const notif = snap.notifications_total
    const sent = getCounterValue(notif, "sent")
    // "push_failure" is the label incremented by the push sender on hard send
    // failures (ExpoPushError / network error).  Falls back to 0 if the
    // backend has not yet recorded any push failures.
    const failed = getCounterValue(notif, "push_failure")

    const total = sent + failed

    if (total < pushMinAttempts) {
      transition(
        "push_send_failure_burst",
        false,
        "Push send sample count below minimum — alert cleared",
        { total, failed },
      )
      return
    }

    const rate = failed / total
    const firing = rate > pushFailureRateThreshold

    transition(
      "push_send_failure_burst",
      firing,
      firing
        ? `Push send failure rate ${(rate * 100).toFixed(1)}% exceeds threshold ${(pushFailureRateThreshold * 100).toFixed(1)}%`
        : `Push send failure rate ${(rate * 100).toFixed(1)}% is within threshold`,
      { total, sent, failed, rate_pct: Math.round(rate * 10_000) / 100 },
    )
  }

  function checkPluginOnlineDrop(snap: MetricsSnapshot) {
    const connected = snap.socket_connected_devices

    if (connected > pluginOnlineFloor) {
      pluginDevicesPreviouslyAboveFloor = true
      transition(
        "plugin_online_drop",
        false,
        `Plugin device count ${connected} is above floor ${pluginOnlineFloor}`,
        { connected, floor: pluginOnlineFloor },
      )
      return
    }

    // connected <= floor; only fire if we've seen higher counts before
    if (!pluginDevicesPreviouslyAboveFloor) {
      // Still at or below floor on startup — do not fire yet
      return
    }

    transition(
      "plugin_online_drop",
      true,
      `Plugin device count ${connected} dropped to or below floor ${pluginOnlineFloor}`,
      { connected, floor: pluginOnlineFloor },
    )
  }

  // ─── Main check loop ───────────────────────────────────────────────────────

  function checkNow() {
    const snap = metrics.snapshot()
    checkRelayTimeoutRate(snap)
    checkIngestFailureRate(snap)
    checkPushSendFailureBurst(snap)
    checkPluginOnlineDrop(snap)
  }

  return {
    start() {
      if (timer !== null) return
      timer = setInterval(checkNow, pollIntervalMs)
    },
    stop() {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
    checkNow,
  }
}
