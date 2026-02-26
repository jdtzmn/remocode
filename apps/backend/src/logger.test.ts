import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createLogger, redactString } from "./logger"

// ─── redactString ─────────────────────────────────────────────────────────────

describe("redactString", () => {
  it("leaves a plain string unchanged", () => {
    expect(redactString("hello world")).toBe("hello world")
  })

  it("redacts a JWT (three base64url segments separated by dots)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    expect(redactString(jwt)).toBe("<jwt:redacted>")
  })

  it("masks a PAT secret, keeping prefix", () => {
    const pat = "pat_abc123_supersecretvalue"
    expect(redactString(pat)).toBe("pat_abc123_<redacted>")
  })

  it("leaves a uuid unchanged", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000"
    expect(redactString(uuid)).toBe(uuid)
  })
})

// ─── createLogger ─────────────────────────────────────────────────────────────

describe("createLogger", () => {
  let stdoutLines: string[]
  let stderrLines: string[]
  let originalStdoutWrite: typeof process.stdout.write
  let originalStderrWrite: typeof process.stderr.write

  beforeEach(() => {
    stdoutLines = []
    stderrLines = []
    originalStdoutWrite = process.stdout.write.bind(process.stdout)
    originalStderrWrite = process.stderr.write.bind(process.stderr)

    process.stdout.write = (chunk: unknown) => {
      stdoutLines.push(String(chunk).trim())
      return true
    }
    process.stderr.write = (chunk: unknown) => {
      stderrLines.push(String(chunk).trim())
      return true
    }
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  })

  function parseStdout(index = 0): Record<string, unknown> {
    return JSON.parse(stdoutLines[index] ?? "{}")
  }

  function parseStderr(index = 0): Record<string, unknown> {
    return JSON.parse(stderrLines[index] ?? "{}")
  }

  it("writes info to stdout as valid JSON", () => {
    const log = createLogger()
    log.info("test message")
    const entry = parseStdout()
    expect(entry.level).toBe("info")
    expect(entry.message).toBe("test message")
    expect(typeof entry.ts).toBe("string")
  })

  it("writes error to stderr", () => {
    const log = createLogger()
    log.error("something went wrong")
    const entry = parseStderr()
    expect(entry.level).toBe("error")
    expect(entry.message).toBe("something went wrong")
  })

  it("writes warn to stderr", () => {
    const log = createLogger()
    log.warn("be careful")
    const entry = parseStderr()
    expect(entry.level).toBe("warn")
  })

  it("writes debug to stdout", () => {
    const log = createLogger()
    log.debug("verbose detail")
    const entry = parseStdout()
    expect(entry.level).toBe("debug")
  })

  it("includes required keys from call context", () => {
    const log = createLogger()
    log.info("test", {
      user_id: "user_1",
      device_id: "dev_1",
      event_id: "evt_1",
      session_id: "sess_1",
      request_id: "req_1",
      command_id: "cmd_1",
      client_action_id: "cai_1",
    })
    const entry = parseStdout()
    expect(entry.user_id).toBe("user_1")
    expect(entry.device_id).toBe("dev_1")
    expect(entry.event_id).toBe("evt_1")
    expect(entry.session_id).toBe("sess_1")
    expect(entry.request_id).toBe("req_1")
    expect(entry.command_id).toBe("cmd_1")
    expect(entry.client_action_id).toBe("cai_1")
  })

  it("includes base context from createLogger call", () => {
    const log = createLogger({ service: "backend" })
    log.info("msg")
    const entry = parseStdout()
    expect(entry.service).toBe("backend")
  })

  it("merges child context with base context", () => {
    const log = createLogger({ service: "backend" })
    const child = log.child({ user_id: "user_abc" })
    child.info("child msg")
    const entry = parseStdout()
    expect(entry.service).toBe("backend")
    expect(entry.user_id).toBe("user_abc")
  })

  it("call context overrides base context", () => {
    const log = createLogger({ user_id: "base_user" })
    log.info("msg", { user_id: "call_user" })
    const entry = parseStdout()
    expect(entry.user_id).toBe("call_user")
  })

  it("omits null required keys from output", () => {
    const log = createLogger()
    log.info("msg", { user_id: null })
    const entry = parseStdout()
    expect("user_id" in entry).toBe(false)
  })

  it("redacts JWTs in context values", () => {
    const log = createLogger()
    log.info("msg", {
      token:
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    })
    const entry = parseStdout()
    expect(entry.token).toBe("<jwt:redacted>")
  })

  it("redacts PAT secret in context values", () => {
    const log = createLogger()
    log.info("msg", { token: "pat_prefix_secretpart" })
    const entry = parseStdout()
    expect(entry.token).toBe("pat_prefix_<redacted>")
  })

  it("does not redact non-string context values", () => {
    const log = createLogger()
    log.info("msg", { count: 42, flag: true })
    const entry = parseStdout()
    expect(entry.count).toBe(42)
    expect(entry.flag).toBe(true)
  })
})
