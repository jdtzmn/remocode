import { afterEach, describe, expect, it, vi } from "vitest"

import { MacOSActivityProvider, computeConfidence } from "./activity-provider"

// We can't actually run ioreg/osascript in unit tests, so we mock execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}))

// Mock promisify so it wraps our mocked execFile
vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}))

import { execFile } from "node:child_process"

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>

describe("MacOSActivityProvider", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("getIdleSeconds", () => {
    it("returns idle seconds parsed from ioreg output", async () => {
      // HIDIdleTime in nanoseconds: 30 * 1e9 = 30_000_000_000
      mockExecFile.mockResolvedValue({ stdout: "HIDIdleTime = 30000000000\n", stderr: "" })
      const provider = new MacOSActivityProvider()
      const result = await provider.getIdleSeconds()
      expect(result).toBe(30)
    })

    it("returns null when ioreg output has no HIDIdleTime", async () => {
      mockExecFile.mockResolvedValue({ stdout: "no idle time here\n", stderr: "" })
      const provider = new MacOSActivityProvider()
      const result = await provider.getIdleSeconds()
      expect(result).toBeNull()
    })

    it("returns null when ioreg command fails", async () => {
      mockExecFile.mockRejectedValue(new Error("command not found"))
      const provider = new MacOSActivityProvider()
      const result = await provider.getIdleSeconds()
      expect(result).toBeNull()
    })
  })

  describe("isUserActive", () => {
    it("returns true when idle time is below threshold", async () => {
      mockExecFile.mockResolvedValue({ stdout: "HIDIdleTime = 5000000000\n", stderr: "" }) // 5s
      const provider = new MacOSActivityProvider()
      expect(await provider.isUserActive(120)).toBe(true)
    })

    it("returns false when idle time exceeds threshold", async () => {
      mockExecFile.mockResolvedValue({ stdout: "HIDIdleTime = 180000000000\n", stderr: "" }) // 180s
      const provider = new MacOSActivityProvider()
      expect(await provider.isUserActive(120)).toBe(false)
    })

    it("returns null when idle time cannot be determined", async () => {
      mockExecFile.mockRejectedValue(new Error("failed"))
      const provider = new MacOSActivityProvider()
      expect(await provider.isUserActive(120)).toBeNull()
    })
  })

  describe("getFrontmostApp", () => {
    it("returns the frontmost app name", async () => {
      // First call is ioreg (if called), second is osascript — but here we only test getFrontmostApp
      mockExecFile.mockResolvedValue({ stdout: "iTerm2\n", stderr: "" })
      const provider = new MacOSActivityProvider()
      const result = await provider.getFrontmostApp()
      expect(result).toBe("iTerm2")
    })

    it("returns null when osascript fails", async () => {
      mockExecFile.mockRejectedValue(new Error("osascript error"))
      const provider = new MacOSActivityProvider()
      const result = await provider.getFrontmostApp()
      expect(result).toBeNull()
    })

    it("returns null when stdout is empty", async () => {
      mockExecFile.mockResolvedValue({ stdout: "   \n", stderr: "" })
      const provider = new MacOSActivityProvider()
      const result = await provider.getFrontmostApp()
      expect(result).toBeNull()
    })
  })

  describe("getTerminalFrontmost", () => {
    it("returns true when a terminal is frontmost", async () => {
      mockExecFile.mockResolvedValue({ stdout: "iTerm2\n", stderr: "" })
      const provider = new MacOSActivityProvider()
      expect(await provider.getTerminalFrontmost()).toBe(true)
    })

    it("returns false when a non-terminal app is frontmost", async () => {
      mockExecFile.mockResolvedValue({ stdout: "Safari\n", stderr: "" })
      const provider = new MacOSActivityProvider()
      expect(await provider.getTerminalFrontmost()).toBe(false)
    })

    it("returns null when frontmost app cannot be determined", async () => {
      mockExecFile.mockRejectedValue(new Error("failed"))
      const provider = new MacOSActivityProvider()
      expect(await provider.getTerminalFrontmost()).toBeNull()
    })
  })
})

describe("computeConfidence", () => {
  it("returns 'high' when idle seconds is a number", () => {
    expect(computeConfidence(0)).toBe("high")
    expect(computeConfidence(30)).toBe("high")
    expect(computeConfidence(300)).toBe("high")
  })

  it("returns 'low' when idle seconds is null", () => {
    expect(computeConfidence(null)).toBe("low")
  })
})
