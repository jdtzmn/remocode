import type { CanonicalEvent } from "@remocode/contracts"

export type SessionProjectionInput = {
  sessionId: string
  userId: string
  deviceId: string
  receivedAt: Date
}

export type SessionProjectionUpdate = {
  title?: string | null
  directory?: string | null
  sessionState?: "busy" | "retry" | "idle" | "unknown"
  isOpen?: boolean
  requiresAttention?: boolean
  lastEventAt?: Date
  lastStatusAt?: Date
  lastHeartbeatAt?: Date
}

export type SessionProjectionStore = {
  upsertSession: (input: SessionProjectionInput & SessionProjectionUpdate) => Promise<void>
  updateSession: (
    sessionId: string,
    userId: string,
    update: SessionProjectionUpdate,
  ) => Promise<void>
  updateSessionsHeartbeat: (
    sessionIds: string[],
    userId: string,
    lastHeartbeatAt: Date,
  ) => Promise<void>
}

export type SessionProjectionReducer = (args: {
  event: CanonicalEvent
  userId: string
  deviceId: string
  receivedAt: Date
}) => Promise<void>

export function createSessionProjectionReducer(
  store: SessionProjectionStore,
): SessionProjectionReducer {
  return async ({ event, userId, deviceId, receivedAt }) => {
    switch (event.event_type) {
      case "session.created": {
        await store.upsertSession({
          sessionId: event.session_id,
          userId,
          deviceId,
          receivedAt,
          title: event.payload.info.title,
          directory: event.payload.info.directory,
          sessionState: "unknown",
          isOpen: true,
          lastEventAt: receivedAt,
        })
        break
      }

      case "session.updated": {
        await store.updateSession(event.session_id, userId, {
          title: event.payload.info.title,
          directory: event.payload.info.directory,
          lastEventAt: receivedAt,
        })
        break
      }

      case "session.deleted": {
        await store.updateSession(event.session_id, userId, {
          isOpen: false,
          requiresAttention: false,
          lastEventAt: receivedAt,
        })
        break
      }

      case "session.status": {
        const statusType = event.payload.status.type
        const sessionState: "busy" | "retry" | "idle" | "unknown" =
          statusType === "busy" || statusType === "retry" || statusType === "idle"
            ? statusType
            : "unknown"

        await store.updateSession(event.session_id, userId, {
          sessionState,
          lastStatusAt: receivedAt,
          lastEventAt: receivedAt,
        })
        break
      }

      case "plugin.heartbeat": {
        const activeSessionIds = event.payload.active_session_ids
        if (activeSessionIds.length > 0) {
          await store.updateSessionsHeartbeat(activeSessionIds, userId, receivedAt)
        }
        break
      }

      default:
        // Other event types (plugin.connected, device.activity, permission.*, question.*) don't
        // update session_projections in TAS-11 scope; attention updates are TAS-12.
        break
    }
  }
}
