import { and, eq } from "drizzle-orm"

import { db } from "../db"
import { devices } from "../db/schema"

export async function getOrCreateDeviceIdForUser(args: { userId: string; deviceUid: string }) {
  const existing = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, args.userId), eq(devices.deviceUid, args.deviceUid)))
    .limit(1)

  if (existing.length > 0) {
    return existing[0].id
  }

  const inserted = await db
    .insert(devices)
    .values({
      userId: args.userId,
      deviceUid: args.deviceUid,
    })
    .onConflictDoNothing({
      target: [devices.userId, devices.deviceUid],
    })
    .returning({ id: devices.id })

  if (inserted.length > 0) {
    return inserted[0].id
  }

  const found = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, args.userId), eq(devices.deviceUid, args.deviceUid)))
    .limit(1)

  if (found.length === 0) {
    throw new Error("Unable to resolve device")
  }

  return found[0].id
}
