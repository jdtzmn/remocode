import { describe, expect, it, vi } from "vitest"

import { createAlertEngine } from "./alerts"
import type { AlertEvent } from "./alerts"
import { createMetricsRegistry } from "./metrics"

// ─── Helpers ──────────────────────────────────────────────────────────────────

type EngineOverrides = Omit<Parameters<typeof createAlertEngine>[0], "metrics" | "onAlert">

function makeEngine(overrides?: EngineOverrides) {
  const metrics = createMetricsRegistry()
  const events: AlertEvent[] = []
  const onAlert = (e: AlertEvent) => {
    events.push(e)
  }
  const engine = createAlertEngine({
    metrics,
    onAlert,
    // Low minimums so unit tests don't need huge sample counts
    relayMinAttempts: 5,
    relayTimeoutRateThreshold: 0.1,
    ingestMinAttempts: 5,
    ingestFailureRateThreshold: 0.5,
    pushMinAttempts: 3,
    pushFailureRateThreshold: 0.25,
    pluginOnlineFloor: 0,
    ...overrides,
  })
  return { metrics, events, engine }
}

// ─── relay_timeout_rate ───────────────────────────────────────────────────────

describe("relay_timeout_rate alert", () => {
  it("does not fire when total relay attempts are below minimum", () => {
    const { metrics, events, engine } = makeEngine()
    // Only 4 relay attempts (below default min 5)
    metrics.recordRelay("timeout")
    metrics.recordRelay("timeout")
    metrics.recordRelay("success")
    metrics.recordRelay("success")
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "relay_timeout_rate" && e.state === "firing"),
    ).toHaveLength(0)
  })

  it("fires when timeout rate exceeds threshold", () => {
    const { metrics, events, engine } = makeEngine()
    // 2 timeout, 8 success = 20 % timeout rate (threshold 10 %)
    for (let i = 0; i < 2; i++) metrics.recordRelay("timeout")
    for (let i = 0; i < 8; i++) metrics.recordRelay("success")
    engine.checkNow()
    const firing = events.find((e) => e.name === "relay_timeout_rate" && e.state === "firing")
    expect(firing).toBeDefined()
    expect(firing?.details.timeout).toBe(2)
    expect(firing?.details.total).toBe(10)
  })

  it("resolves when timeout rate drops back below threshold", () => {
    const { metrics, events, engine } = makeEngine()
    // First: fire alert
    for (let i = 0; i < 2; i++) metrics.recordRelay("timeout")
    for (let i = 0; i < 8; i++) metrics.recordRelay("success")
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "relay_timeout_rate" && e.state === "firing"),
    ).toHaveLength(1)

    // Add many more successes so rate drops well below threshold
    for (let i = 0; i < 100; i++) metrics.recordRelay("success")
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "relay_timeout_rate" && e.state === "resolved"),
    ).toHaveLength(1)
  })

  it("does not re-fire when already firing", () => {
    const { metrics, events, engine } = makeEngine()
    for (let i = 0; i < 2; i++) metrics.recordRelay("timeout")
    for (let i = 0; i < 8; i++) metrics.recordRelay("success")
    engine.checkNow()
    engine.checkNow() // second check — no new events
    expect(
      events.filter((e) => e.name === "relay_timeout_rate" && e.state === "firing"),
    ).toHaveLength(1)
  })

  it("does not fire when timeout rate is exactly at threshold", () => {
    const { metrics, events, engine } = makeEngine({
      relayMinAttempts: 5,
      relayTimeoutRateThreshold: 0.2,
    })
    // exactly 20 % — boundary: should NOT fire (threshold is >, not >=)
    metrics.recordRelay("timeout")
    for (let i = 0; i < 4; i++) metrics.recordRelay("success")
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "relay_timeout_rate" && e.state === "firing"),
    ).toHaveLength(0)
  })
})

// ─── ingest_failure_rate ──────────────────────────────────────────────────────

describe("ingest_failure_rate alert", () => {
  it("does not fire when total ingest attempts are below minimum", () => {
    const { metrics, events, engine } = makeEngine()
    // Only 2 deduped events, 2 ingested (total 4 < min 5)
    metrics.recordEventIngested("session.created")
    metrics.recordEventIngested("session.created")
    metrics.recordEventDeduped()
    metrics.recordEventDeduped()
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "ingest_failure_rate" && e.state === "firing"),
    ).toHaveLength(0)
  })

  it("fires when dedup rate exceeds threshold", () => {
    const { metrics, events, engine } = makeEngine()
    // 4 ingested, 6 deduped = dedup / total = 6/10 = 60 % (threshold 50 %)
    for (let i = 0; i < 4; i++) metrics.recordEventIngested("session.created")
    for (let i = 0; i < 6; i++) metrics.recordEventDeduped()
    engine.checkNow()
    const firing = events.find((e) => e.name === "ingest_failure_rate" && e.state === "firing")
    expect(firing).toBeDefined()
    expect(firing?.details.deduped).toBe(6)
    expect(firing?.details.total).toBe(10)
  })

  it("resolves when dedup rate drops back below threshold", () => {
    const { metrics, events, engine } = makeEngine()
    // Fire alert
    for (let i = 0; i < 4; i++) metrics.recordEventIngested("session.created")
    for (let i = 0; i < 6; i++) metrics.recordEventDeduped()
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "ingest_failure_rate" && e.state === "firing"),
    ).toHaveLength(1)

    // Flood with new unique events to bring rate down
    for (let i = 0; i < 100; i++) metrics.recordEventIngested("session.status")
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "ingest_failure_rate" && e.state === "resolved"),
    ).toHaveLength(1)
  })
})

// ─── push_send_failure_burst ──────────────────────────────────────────────────

describe("push_send_failure_burst alert", () => {
  it("does not fire when push send attempts are below minimum", () => {
    const { metrics, events, engine } = makeEngine()
    // 2 sent, 0 failed — total 2 < min 3
    metrics.recordNotification("sent")
    metrics.recordNotification("sent")
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "push_send_failure_burst" && e.state === "firing"),
    ).toHaveLength(0)
  })

  it("does not fire when push failure rate is below threshold", () => {
    const { metrics, events, engine } = makeEngine()
    // 10 sent, 0 push_failure — rate 0 %
    for (let i = 0; i < 10; i++) metrics.recordNotification("sent")
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "push_send_failure_burst" && e.state === "firing"),
    ).toHaveLength(0)
  })

  it("fires when push failure rate exceeds threshold", () => {
    const { metrics, events, engine } = makeEngine()
    // 3 sent, 2 push_failure = 40 % (threshold 25 %)
    for (let i = 0; i < 3; i++) metrics.recordNotification("sent")
    for (let i = 0; i < 2; i++) metrics.recordNotification("push_failure")
    engine.checkNow()
    const firing = events.find((e) => e.name === "push_send_failure_burst" && e.state === "firing")
    expect(firing).toBeDefined()
    expect(firing?.details.failed).toBe(2)
    expect(firing?.details.sent).toBe(3)
  })

  it("resolves when push failure rate recovers", () => {
    const { metrics, events, engine } = makeEngine()
    // Fire alert
    for (let i = 0; i < 3; i++) metrics.recordNotification("sent")
    for (let i = 0; i < 2; i++) metrics.recordNotification("push_failure")
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "push_send_failure_burst" && e.state === "firing"),
    ).toHaveLength(1)

    // Add many successful sends
    for (let i = 0; i < 30; i++) metrics.recordNotification("sent")
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "push_send_failure_burst" && e.state === "resolved"),
    ).toHaveLength(1)
  })
})

// ─── plugin_online_drop ───────────────────────────────────────────────────────

describe("plugin_online_drop alert", () => {
  it("does not fire on startup when device count is already 0", () => {
    const { events, engine } = makeEngine()
    // Default socket_connected_devices = 0, but we haven't seen it above floor
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "plugin_online_drop" && e.state === "firing"),
    ).toHaveLength(0)
  })

  it("fires when device count drops to 0 after being above floor", () => {
    const { metrics, events, engine } = makeEngine()
    // First tick: devices connected
    metrics.setSocketConnectedDevices(3)
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "plugin_online_drop" && e.state === "firing"),
    ).toHaveLength(0)

    // Second tick: all devices gone
    metrics.setSocketConnectedDevices(0)
    engine.checkNow()
    const firing = events.find((e) => e.name === "plugin_online_drop" && e.state === "firing")
    expect(firing).toBeDefined()
    expect(firing?.details.connected).toBe(0)
  })

  it("resolves when devices reconnect above floor", () => {
    const { metrics, events, engine } = makeEngine()
    metrics.setSocketConnectedDevices(2)
    engine.checkNow()
    metrics.setSocketConnectedDevices(0)
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "plugin_online_drop" && e.state === "firing"),
    ).toHaveLength(1)

    metrics.setSocketConnectedDevices(1)
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "plugin_online_drop" && e.state === "resolved"),
    ).toHaveLength(1)
  })

  it("does not re-fire when already in firing state", () => {
    const { metrics, events, engine } = makeEngine()
    metrics.setSocketConnectedDevices(1)
    engine.checkNow()
    metrics.setSocketConnectedDevices(0)
    engine.checkNow()
    engine.checkNow() // second check at 0 — no new events
    expect(
      events.filter((e) => e.name === "plugin_online_drop" && e.state === "firing"),
    ).toHaveLength(1)
  })

  it("respects a custom floor threshold", () => {
    const { metrics, events, engine } = makeEngine({ pluginOnlineFloor: 2 })
    // 3 devices above floor of 2
    metrics.setSocketConnectedDevices(3)
    engine.checkNow()
    expect(
      events.filter((e) => e.name === "plugin_online_drop" && e.state === "firing"),
    ).toHaveLength(0)

    // Drop to 2 which equals the floor — fires
    metrics.setSocketConnectedDevices(2)
    engine.checkNow()
    const firing = events.find((e) => e.name === "plugin_online_drop" && e.state === "firing")
    expect(firing).toBeDefined()
    expect(firing?.details.connected).toBe(2)
    expect(firing?.details.floor).toBe(2)
  })
})

// ─── start / stop (timer management) ─────────────────────────────────────────

describe("AlertEngine start / stop", () => {
  it("start and stop do not throw", () => {
    const { engine } = makeEngine()
    expect(() => {
      engine.start()
      engine.stop()
    }).not.toThrow()
  })

  it("start is idempotent (calling twice does not throw)", () => {
    const { engine } = makeEngine()
    expect(() => {
      engine.start()
      engine.start()
      engine.stop()
    }).not.toThrow()
  })

  it("stop is idempotent (calling twice does not throw)", () => {
    const { engine } = makeEngine()
    engine.start()
    expect(() => {
      engine.stop()
      engine.stop()
    }).not.toThrow()
  })

  it("polling calls checkNow at each interval", async () => {
    vi.useFakeTimers()
    const { metrics, events, engine } = makeEngine({ pollIntervalMs: 100 })

    // Arm a firing condition
    for (let i = 0; i < 2; i++) metrics.recordRelay("timeout")
    for (let i = 0; i < 8; i++) metrics.recordRelay("success")

    engine.start()
    vi.advanceTimersByTime(200)
    engine.stop()
    vi.useRealTimers()

    // The alert should have fired on the first tick
    expect(
      events.filter((e) => e.name === "relay_timeout_rate" && e.state === "firing"),
    ).toHaveLength(1)
  })
})
