import type { RequestsOpenResponseSchema, SessionsOpenResponseSchema } from "@remocode/contracts"
import type { z } from "zod"

export type SessionsDeltaPayload = z.infer<typeof SessionsOpenResponseSchema>
export type RequestsDeltaPayload = z.infer<typeof RequestsOpenResponseSchema>

/**
 * Emits realtime delta events to the app namespace user room after projection updates.
 *
 * Both methods are called with the userId whose data changed. The implementation
 * is responsible for fetching fresh data and emitting to the `user:{userId}` room.
 */
export type SocketDeltaEmitter = {
  emitSessionsDelta: (userId: string) => Promise<void>
  emitRequestsDelta: (userId: string) => Promise<void>
}
