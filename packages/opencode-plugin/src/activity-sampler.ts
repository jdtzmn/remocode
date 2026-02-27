import {
  type ActivityProvider,
  MacOSActivityProvider,
  computeConfidence,
} from "./activity-provider"

export type ActivitySamplerOptions = {
  backendUrl: string
  pat: string
  deviceUid: string
  /** Custom ActivityProvider for testing/cross-OS support. Defaults to MacOSActivityProvider. */
  provider?: ActivityProvider
  /** Interval in milliseconds. Defaults to 15000 (15s). */
  intervalMs?: number
}

export type ActivitySamplerHandle = {
  /** Stop the activity sampler timer */
  stop: () => void
}

export type DeviceActivityPayload = {
  is_active: boolean | null
  idle_seconds: number | null
  frontmost_app: string | null
  terminal_frontmost: boolean | null
  confidence: "high" | "low" | "unknown"
  sampled_at: string
}

/**
 * Samples device activity and sends a device.activity event to the backend.
 * Returns the sampled payload for testing/observability.
 */
export async function sendActivitySample(options: {
  backendUrl: string
  pat: string
  deviceUid: string
  provider: ActivityProvider
}): Promise<DeviceActivityPayload> {
  const { pat, deviceUid, provider } = options
  const backendUrl = options.backendUrl.replace(/\/$/, "")

  // Probe activity in parallel for lower latency
  const [idleSeconds, frontmostApp, terminalFrontmost] = await Promise.all([
    provider.getIdleSeconds(),
    provider.getFrontmostApp(),
    provider.getTerminalFrontmost(),
  ])

  const sampledAt = new Date().toISOString()
  // 120s threshold aligns with suppression matrix in spec section 11.2
  const isActive = idleSeconds !== null ? idleSeconds < 120 : null
  const confidence = computeConfidence(idleSeconds)

  const payload: DeviceActivityPayload = {
    is_active: isActive,
    idle_seconds: idleSeconds,
    frontmost_app: frontmostApp,
    terminal_frontmost: terminalFrontmost,
    confidence,
    sampled_at: sampledAt,
  }

  const response = await fetch(`${backendUrl}/v1/plugin/activity`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({ device_uid: deviceUid, sample: payload }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error")
    throw new Error(`Failed to send device.activity: ${response.status} ${errorText}`)
  }

  return payload
}

/**
 * Starts a repeating activity sampler that sends device.activity events
 * every intervalMs milliseconds (default: 15000ms).
 *
 * Returns a handle to stop the sampler.
 * Errors during individual samples are logged but do not stop the timer.
 */
export function startActivitySampler(options: ActivitySamplerOptions): ActivitySamplerHandle {
  const {
    backendUrl,
    pat,
    deviceUid,
    provider = new MacOSActivityProvider(),
    intervalMs = 15000,
  } = options

  const timerId = setInterval(async () => {
    try {
      await sendActivitySample({ backendUrl, pat, deviceUid, provider })
    } catch (err) {
      console.error("[remocode] Failed to send device.activity:", err)
    }
  }, intervalMs)

  // Allow Node.js to exit even if the timer is still running
  if (timerId.unref) {
    timerId.unref()
  }

  return {
    stop: () => clearInterval(timerId),
  }
}
