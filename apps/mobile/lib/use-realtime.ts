import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import type { RequestsOpenResponse, SessionsOpenResponse } from "./api"
import { useAuth } from "./auth-context"
import { type AppSocket, createAppSocket } from "./socket"

/**
 * Manages the Socket.IO /app namespace connection for the authenticated user.
 *
 * - Connects when a valid session is present, disconnects on sign-out.
 * - Replaces the React Query cache on `sessions.delta` and `requests.delta`.
 * - Handles `request.resolved` and `request.failed` by invalidating the
 *   open-requests query so it refetches with fresh state.
 */
export function useRealtime(): void {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const socketRef = useRef<AppSocket | null>(null)

  useEffect(() => {
    const token = session?.access_token
    if (!token) {
      // Not authenticated – ensure any lingering socket is torn down
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
      return
    }

    // Create a new socket for this token
    const socket = createAppSocket(token)
    socketRef.current = socket

    // ── Event handlers ────────────────────────────────────────────────────

    socket.on("sessions.delta", (data: SessionsOpenResponse) => {
      queryClient.setQueryData<SessionsOpenResponse>(["sessions", "open"], data)
    })

    socket.on("requests.delta", (data: RequestsOpenResponse) => {
      queryClient.setQueryData<RequestsOpenResponse>(["requests", "open"], data)
    })

    socket.on("request.resolved", ({ request_id }: { request_id: string }) => {
      // Update the cached requests list: mark the matching request as resolved
      queryClient.setQueryData<RequestsOpenResponse>(["requests", "open"], (prev) => {
        if (!prev) return prev
        return {
          ...prev,
          requests: prev.requests.map((r) =>
            r.request_id === request_id ? { ...r, status: "resolved" as const } : r,
          ),
        }
      })
      // Also refresh sessions so attention counts/badges update
      void queryClient.invalidateQueries({ queryKey: ["sessions", "open"] })
    })

    socket.on(
      "request.failed",
      ({ request_id }: { request_id: string; code: string; message: string }) => {
        // Remove from open requests on failure so the UI doesn't leave a stale card
        queryClient.setQueryData<RequestsOpenResponse>(["requests", "open"], (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            requests: prev.requests.filter((r) => r.request_id !== request_id),
          }
        })
      },
    )

    socket.connect()

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [session?.access_token, queryClient])
}
