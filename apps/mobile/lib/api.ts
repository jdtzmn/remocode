import { supabase } from "./supabase"

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000"

// ─── Types ─────────────────────────────────────────────────────────────────

export type SessionState = "busy" | "retry" | "idle" | "unknown"

export interface SessionSummary {
  session_id: string
  title: string
  state: SessionState
  requires_attention: boolean
  attention_count: number
  last_event_at: string
  last_attention_at: string | null
  is_stale: boolean
}

export interface DeviceActivitySummary {
  is_active: boolean | null
  idle_seconds: number | null
  sampled_at: string
}

export interface DeviceGroup {
  device: {
    id: string
    name: string | null
    platform: string | null
    last_seen_at: string | null
    activity: DeviceActivitySummary | null
  }
  sessions: SessionSummary[]
}

export interface SessionsOpenResponse {
  groups: DeviceGroup[]
}

export type AttentionRequestKind = "permission" | "question"
export type AttentionRequestStatus = "open" | "resolved" | "rejected" | "expired"

export interface OpenAttentionRequest {
  request_id: string
  session_id: string
  device_id: string
  kind: AttentionRequestKind
  status: AttentionRequestStatus
  opened_at: string
  payload: Record<string, unknown>
}

export interface RequestsOpenResponse {
  requests: OpenAttentionRequest[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function getAuthToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message = (body as { error?: { message?: string } }).error?.message ?? res.statusText
    throw new ApiError(res.status, message, body)
  }

  return res.json() as Promise<T>
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

// ─── Endpoints ─────────────────────────────────────────────────────────────

export async function fetchSessionsOpen(): Promise<SessionsOpenResponse> {
  return apiFetch<SessionsOpenResponse>("/v1/sessions/open")
}

export async function fetchRequestsOpen(): Promise<RequestsOpenResponse> {
  return apiFetch<RequestsOpenResponse>("/v1/requests/open")
}

export interface PermissionRespondRequest {
  type: "permission"
  decision: "once" | "always" | "reject"
  message?: string
  client_action_id: string
}

export interface QuestionRespondAnswersRequest {
  type: "question"
  answers: string[][]
  client_action_id: string
}

export interface QuestionRespondRejectRequest {
  type: "question"
  decision: "reject"
  client_action_id: string
}

export type RespondRequest =
  | PermissionRespondRequest
  | QuestionRespondAnswersRequest
  | QuestionRespondRejectRequest

export interface RespondResponse {
  status: "accepted"
  request_id: string
  relay: "sent"
}

export async function respondToRequest(
  requestId: string,
  body: RespondRequest,
): Promise<RespondResponse> {
  return apiFetch<RespondResponse>(`/v1/requests/${requestId}/respond`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

// ─── Push token ─────────────────────────────────────────────────────────────

export interface RegisterPushTokenRequest {
  expo_push_token: string
  platform: "ios" | "android"
  device_name?: string
  app_version?: string
}

export interface RegisterPushTokenResponse {
  id: string
  expo_push_token: string
  platform: string
  created_at: string
}

export async function registerPushToken(
  body: RegisterPushTokenRequest,
): Promise<RegisterPushTokenResponse> {
  return apiFetch<RegisterPushTokenResponse>("/v1/push-tokens", {
    method: "POST",
    body: JSON.stringify(body),
  })
}
