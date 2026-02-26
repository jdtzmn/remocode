import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const DEVICE_ID_DIR = join(homedir(), ".config", "remocode-plugin")
const DEVICE_ID_PATH = join(DEVICE_ID_DIR, "device-id")

/**
 * Resolves the stable device_uid for this machine.
 *
 * If a device-id file exists at ~/.config/remocode-plugin/device-id, reads it.
 * Otherwise generates a new UUID v4, persists it, and returns it.
 */
export async function resolveDeviceUid(options: { deviceIdPath?: string } = {}): Promise<string> {
  const idPath = options.deviceIdPath ?? DEVICE_ID_PATH

  try {
    const contents = await readFile(idPath, "utf-8")
    const uid = contents.trim()

    if (uid.length > 0) {
      return uid
    }
  } catch {
    // File does not exist yet — generate a new one
  }

  const newUid = randomUUID()
  await mkdir(dirname(idPath), { recursive: true })
  await writeFile(idPath, newUid, "utf-8")

  return newUid
}
