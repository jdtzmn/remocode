import type { CanonicalEvent } from "@remocode/contracts"

export type AttentionRequestInput = {
  requestId: string
  sessionId: string
  userId: string
  deviceId: string
  kind: "permission" | "question"
  payload: Record<string, unknown>
  openedAt: Date
}

export type AttentionRequestStore = {
  upsertRequest: (input: AttentionRequestInput) => Promise<void>
  closeRequest: (args: {
    requestId: string
    userId: string
    status: "resolved" | "rejected"
    resolvedAt: Date
  }) => Promise<void>
  countOpenRequests: (args: { sessionId: string; userId: string }) => Promise<number>
  updateSessionAttention: (args: {
    sessionId: string
    userId: string
    attentionCount: number
    requiresAttention: boolean
    lastAttentionAt: Date | null
  }) => Promise<void>
}

export type AttentionRequestReducer = (args: {
  event: CanonicalEvent
  userId: string
  deviceId: string
  receivedAt: Date
}) => Promise<void>

export function createAttentionRequestReducer(
  store: AttentionRequestStore,
): AttentionRequestReducer {
  return async ({ event, userId, deviceId, receivedAt }) => {
    switch (event.event_type) {
      case "permission.asked": {
        const requestId = event.payload.id
        const sessionId = event.session_id

        await store.upsertRequest({
          requestId,
          sessionId,
          userId,
          deviceId,
          kind: "permission",
          payload: event.payload as Record<string, unknown>,
          openedAt: receivedAt,
        })

        const openCount = await store.countOpenRequests({ sessionId, userId })
        await store.updateSessionAttention({
          sessionId,
          userId,
          attentionCount: openCount,
          requiresAttention: openCount > 0,
          lastAttentionAt: receivedAt,
        })
        break
      }

      case "question.asked": {
        const requestId = event.payload.id
        const sessionId = event.session_id

        await store.upsertRequest({
          requestId,
          sessionId,
          userId,
          deviceId,
          kind: "question",
          payload: event.payload as Record<string, unknown>,
          openedAt: receivedAt,
        })

        const openCount = await store.countOpenRequests({ sessionId, userId })
        await store.updateSessionAttention({
          sessionId,
          userId,
          attentionCount: openCount,
          requiresAttention: openCount > 0,
          lastAttentionAt: receivedAt,
        })
        break
      }

      case "permission.replied": {
        const { requestID, reply } = event.payload
        const sessionId = event.session_id
        const status = reply === "reject" ? "rejected" : "resolved"

        await store.closeRequest({
          requestId: requestID,
          userId,
          status,
          resolvedAt: receivedAt,
        })

        const openCount = await store.countOpenRequests({ sessionId, userId })
        await store.updateSessionAttention({
          sessionId,
          userId,
          attentionCount: openCount,
          requiresAttention: openCount > 0,
          lastAttentionAt: openCount > 0 ? receivedAt : null,
        })
        break
      }

      case "question.replied": {
        const { requestID } = event.payload
        const sessionId = event.session_id

        await store.closeRequest({
          requestId: requestID,
          userId,
          status: "resolved",
          resolvedAt: receivedAt,
        })

        const openCount = await store.countOpenRequests({ sessionId, userId })
        await store.updateSessionAttention({
          sessionId,
          userId,
          attentionCount: openCount,
          requiresAttention: openCount > 0,
          lastAttentionAt: openCount > 0 ? receivedAt : null,
        })
        break
      }

      case "question.rejected": {
        const { requestID } = event.payload
        const sessionId = event.session_id

        await store.closeRequest({
          requestId: requestID,
          userId,
          status: "rejected",
          resolvedAt: receivedAt,
        })

        const openCount = await store.countOpenRequests({ sessionId, userId })
        await store.updateSessionAttention({
          sessionId,
          userId,
          attentionCount: openCount,
          requiresAttention: openCount > 0,
          lastAttentionAt: openCount > 0 ? receivedAt : null,
        })
        break
      }

      default:
        // Other event types don't affect attention_requests
        break
    }
  }
}
