import { create } from "zustand"

// ─── UI State Store ─────────────────────────────────────────────────────────
// Manages transient UI state: expanded device groups, active action modal,
// and pending request action states.

interface AttentionStore {
  // Expanded device groups (by device id)
  expandedDeviceIds: Set<string>
  toggleDeviceExpanded: (deviceId: string) => void
  setDeviceExpanded: (deviceId: string, expanded: boolean) => void

  // Active action modal
  activeRequestId: string | null
  setActiveRequestId: (requestId: string | null) => void

  // Pending action states (request_id -> true while action is in-flight)
  pendingRequestIds: Set<string>
  setRequestPending: (requestId: string, pending: boolean) => void
  isRequestPending: (requestId: string) => boolean
}

export const useAttentionStore = create<AttentionStore>((set, get) => ({
  expandedDeviceIds: new Set<string>(),
  toggleDeviceExpanded: (deviceId) =>
    set((state) => {
      const next = new Set(state.expandedDeviceIds)
      if (next.has(deviceId)) {
        next.delete(deviceId)
      } else {
        next.add(deviceId)
      }
      return { expandedDeviceIds: next }
    }),
  setDeviceExpanded: (deviceId, expanded) =>
    set((state) => {
      const next = new Set(state.expandedDeviceIds)
      if (expanded) {
        next.add(deviceId)
      } else {
        next.delete(deviceId)
      }
      return { expandedDeviceIds: next }
    }),

  activeRequestId: null,
  setActiveRequestId: (requestId) => set({ activeRequestId: requestId }),

  pendingRequestIds: new Set<string>(),
  setRequestPending: (requestId, pending) =>
    set((state) => {
      const next = new Set(state.pendingRequestIds)
      if (pending) {
        next.add(requestId)
      } else {
        next.delete(requestId)
      }
      return { pendingRequestIds: next }
    }),
  isRequestPending: (requestId) => get().pendingRequestIds.has(requestId),
}))
