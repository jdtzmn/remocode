import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { resolveDeviceUid } from "./device-uid"

describe("resolveDeviceUid", () => {
  let tempDir: string
  let idPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "remocode-test-"))
    idPath = join(tempDir, "device-id")
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("generates a new UUID when no file exists", async () => {
    const uid = await resolveDeviceUid({ deviceIdPath: idPath })

    expect(uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it("persists the UUID to disk on first call", async () => {
    const uid = await resolveDeviceUid({ deviceIdPath: idPath })

    const { readFile } = await import("node:fs/promises")
    const stored = await readFile(idPath, "utf-8")
    expect(stored.trim()).toBe(uid)
  })

  it("returns the same UUID on subsequent calls", async () => {
    const uid1 = await resolveDeviceUid({ deviceIdPath: idPath })
    const uid2 = await resolveDeviceUid({ deviceIdPath: idPath })

    expect(uid1).toBe(uid2)
  })

  it("creates nested directories if they do not exist", async () => {
    const nestedPath = join(tempDir, "deeply", "nested", "device-id")
    const uid = await resolveDeviceUid({ deviceIdPath: nestedPath })

    expect(uid).toBeTruthy()

    const { readFile } = await import("node:fs/promises")
    const stored = await readFile(nestedPath, "utf-8")
    expect(stored.trim()).toBe(uid)
  })

  it("reads an existing device-id file without regenerating", async () => {
    const existingUid = "550e8400-e29b-41d4-a716-446655440000"

    const { mkdir, writeFile } = await import("node:fs/promises")
    await mkdir(tempDir, { recursive: true })
    await writeFile(idPath, existingUid, "utf-8")

    const uid = await resolveDeviceUid({ deviceIdPath: idPath })
    expect(uid).toBe(existingUid)
  })
})
