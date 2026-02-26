import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/**
 * Cross-OS interface for activity detection.
 * Unsupported fields return null.
 */
export interface ActivityProvider {
  /** Returns seconds since last user input, or null if unknown */
  getIdleSeconds(): Promise<number | null>
  /** Returns true if user is actively using the computer (idle < thresholdSec), or null if unknown */
  isUserActive(thresholdSec: number): Promise<boolean | null>
  /** Returns the name of the frontmost application, or null if unknown */
  getFrontmostApp(): Promise<string | null>
  /** Returns true if a terminal is the frontmost application, or null if unknown */
  getTerminalFrontmost(): Promise<boolean | null>
}

/** Apps considered terminals for terminal_frontmost detection */
const TERMINAL_APPS = new Set([
  "Terminal",
  "iTerm2",
  "iTerm",
  "Alacritty",
  "WezTerm",
  "Hyper",
  "Kitty",
  "kitty",
  "Ghostty",
])

/**
 * macOS implementation of ActivityProvider.
 * Uses ioreg for idle time and AppleScript for frontmost app detection.
 */
export class MacOSActivityProvider implements ActivityProvider {
  /**
   * Gets the system idle time in seconds using IOKit via ioreg.
   * Returns null if the command fails.
   */
  async getIdleSeconds(): Promise<number | null> {
    try {
      // ioreg reports HIDIdleTime in nanoseconds
      const { stdout } = await execFileAsync("ioreg", ["-c", "IOHIDSystem", "-d", "4", "-S"])
      const match = /HIDIdleTime\s*=\s*(\d+)/.exec(stdout)
      if (!match) return null
      const nanos = Number(match[1])
      return Math.floor(nanos / 1_000_000_000)
    } catch {
      return null
    }
  }

  /**
   * Returns true if the user has been active within thresholdSec seconds.
   * Returns null if idle time cannot be determined.
   */
  async isUserActive(thresholdSec: number): Promise<boolean | null> {
    const idleSec = await this.getIdleSeconds()
    if (idleSec === null) return null
    return idleSec < thresholdSec
  }

  /**
   * Gets the name of the frontmost (focused) application using AppleScript.
   * Returns null if the call fails (e.g., on non-macOS, or permissions denied).
   */
  async getFrontmostApp(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ])
      return stdout.trim() || null
    } catch {
      return null
    }
  }

  /**
   * Returns true if a terminal app is currently frontmost.
   * Returns null if the frontmost app cannot be determined.
   */
  async getTerminalFrontmost(): Promise<boolean | null> {
    const app = await this.getFrontmostApp()
    if (app === null) return null
    return TERMINAL_APPS.has(app)
  }
}

/**
 * Returns a confidence level based on idle time.
 * - "high": idle time is fresh and reliable
 * - "low": could not determine idle time
 * - "unknown": unexpected conditions
 */
export function computeConfidence(idleSeconds: number | null): "high" | "low" | "unknown" {
  if (idleSeconds === null) return "low"
  return "high"
}
