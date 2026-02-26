/**
 * Notification suppression decision matrix.
 *
 * Spec (section 11.2):
 *   Inputs:
 *     - latest device_activity sample for source device
 *     - sample freshness (<= 45s)
 *     - is_active
 *     - idle_seconds
 *
 *   Rules:
 *     1. if sample fresh AND is_active=true AND idle_seconds < 120 -> suppress
 *     2. else -> send  (fail-open for attention-critical workflow)
 */

export type ActivitySample = {
  isActive: boolean | null
  idleSeconds: number | null
  sampledAt: Date
}

export type SuppressionDecision =
  | { decision: "suppress"; reason: string }
  | { decision: "send"; reason: string }

/** Max age (ms) for a sample to be considered "fresh". */
const SAMPLE_FRESHNESS_MS = 45_000

/** Idle threshold (seconds) below which the user is considered active. */
const IDLE_THRESHOLD_SEC = 120

export function decideSuppression(
  sample: ActivitySample | null,
  now: Date = new Date(),
): SuppressionDecision {
  if (!sample) {
    return { decision: "send", reason: "no_activity_sample" }
  }

  const ageMs = now.getTime() - sample.sampledAt.getTime()

  if (ageMs > SAMPLE_FRESHNESS_MS) {
    return { decision: "send", reason: "stale_sample" }
  }

  if (sample.isActive !== true) {
    return { decision: "send", reason: "device_inactive" }
  }

  if (sample.idleSeconds === null || sample.idleSeconds >= IDLE_THRESHOLD_SEC) {
    return { decision: "send", reason: "idle_threshold_exceeded" }
  }

  return { decision: "suppress", reason: "device_active" }
}
