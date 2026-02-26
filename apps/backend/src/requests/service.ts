import type { OpenAttentionRequestSchema, RequestsOpenResponseSchema } from "@remocode/contracts"
import type { z } from "zod"

type OpenAttentionRequest = z.infer<typeof OpenAttentionRequestSchema>
export type RequestsOpenResponse = z.infer<typeof RequestsOpenResponseSchema>

export type OpenRequestRow = {
  requestId: string
  sessionId: string
  deviceId: string
  kind: "permission" | "question"
  status: "open" | "resolved" | "rejected" | "expired"
  openedAt: Date
  payload: Record<string, unknown>
}

export type RequestsOpenStore = {
  getOpenRequests: (args: { userId: string }) => Promise<OpenRequestRow[]>
}

export type RequestsOpenService = (args: { userId: string }) => Promise<RequestsOpenResponse>

function toOpenAttentionRequest(row: OpenRequestRow): OpenAttentionRequest {
  return {
    request_id: row.requestId,
    session_id: row.sessionId,
    device_id: row.deviceId,
    kind: row.kind,
    status: row.status,
    opened_at: row.openedAt.toISOString(),
    payload: row.payload,
  }
}

export function createRequestsOpenService(store: RequestsOpenStore): RequestsOpenService {
  return async ({ userId }) => {
    const rows = await store.getOpenRequests({ userId })

    return {
      requests: rows.map(toOpenAttentionRequest),
    }
  }
}
