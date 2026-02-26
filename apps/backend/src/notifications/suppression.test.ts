import { describe, expect, it } from "vitest"

import { decideSuppression } from "./suppression"
import type { ActivitySample } from "./suppression"

function freshSample(overrides: Partial<ActivitySample> = {}): ActivitySample {
  return {
    isActive: true,
    idleSeconds: 10,
    sampledAt: new Date(),
    ...overrides,
  }
}

describe("decideSuppression", () => {
  it("sends when there is no activity sample", () => {
    const result = decideSuppression(null)
    expect(result.decision).toBe("send")
    expect(result.reason).toBe("no_activity_sample")
  })

  it("sends when sample is stale (> 45s old)", () => {
    const staleSampledAt = new Date(Date.now() - 46_000)
    const sample = freshSample({ sampledAt: staleSampledAt })
    const result = decideSuppression(sample)
    expect(result.decision).toBe("send")
    expect(result.reason).toBe("stale_sample")
  })

  it("sends when sample is exactly at freshness boundary (45s old)", () => {
    const staleSampledAt = new Date(Date.now() - 45_001)
    const sample = freshSample({ sampledAt: staleSampledAt })
    const result = decideSuppression(sample)
    expect(result.decision).toBe("send")
    expect(result.reason).toBe("stale_sample")
  })

  it("suppresses when sample is fresh, device is active, and idle < 120s", () => {
    const sample = freshSample({ isActive: true, idleSeconds: 10 })
    const result = decideSuppression(sample)
    expect(result.decision).toBe("suppress")
    expect(result.reason).toBe("device_active")
  })

  it("suppresses when idle is 0", () => {
    const sample = freshSample({ isActive: true, idleSeconds: 0 })
    const result = decideSuppression(sample)
    expect(result.decision).toBe("suppress")
  })

  it("suppresses when idle is 119 (just under threshold)", () => {
    const sample = freshSample({ isActive: true, idleSeconds: 119 })
    const result = decideSuppression(sample)
    expect(result.decision).toBe("suppress")
  })

  it("sends when idle equals threshold (120s)", () => {
    const sample = freshSample({ isActive: true, idleSeconds: 120 })
    const result = decideSuppression(sample)
    expect(result.decision).toBe("send")
    expect(result.reason).toBe("idle_threshold_exceeded")
  })

  it("sends when idle exceeds threshold (200s)", () => {
    const sample = freshSample({ isActive: true, idleSeconds: 200 })
    const result = decideSuppression(sample)
    expect(result.decision).toBe("send")
    expect(result.reason).toBe("idle_threshold_exceeded")
  })

  it("sends when is_active is false (fresh sample)", () => {
    const sample = freshSample({ isActive: false, idleSeconds: 5 })
    const result = decideSuppression(sample)
    expect(result.decision).toBe("send")
    expect(result.reason).toBe("device_inactive")
  })

  it("sends when is_active is null (fresh sample)", () => {
    const sample = freshSample({ isActive: null, idleSeconds: 5 })
    const result = decideSuppression(sample)
    expect(result.decision).toBe("send")
    expect(result.reason).toBe("device_inactive")
  })

  it("sends when idle_seconds is null even if is_active is true", () => {
    const sample = freshSample({ isActive: true, idleSeconds: null })
    const result = decideSuppression(sample)
    expect(result.decision).toBe("send")
    expect(result.reason).toBe("idle_threshold_exceeded")
  })

  it("accepts a custom 'now' timestamp for testing", () => {
    const sampledAt = new Date("2026-01-01T12:00:00.000Z")
    const now = new Date("2026-01-01T12:00:10.000Z") // 10s later — fresh
    const sample: ActivitySample = { isActive: true, idleSeconds: 5, sampledAt }
    const result = decideSuppression(sample, now)
    expect(result.decision).toBe("suppress")
  })

  it("sends when using custom 'now' that makes sample stale", () => {
    const sampledAt = new Date("2026-01-01T12:00:00.000Z")
    const now = new Date("2026-01-01T12:01:00.000Z") // 60s later — stale
    const sample: ActivitySample = { isActive: true, idleSeconds: 5, sampledAt }
    const result = decideSuppression(sample, now)
    expect(result.decision).toBe("send")
    expect(result.reason).toBe("stale_sample")
  })
})
