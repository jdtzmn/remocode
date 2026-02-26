import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { ActionSheet } from "../../components/ActionSheet"
import { DeviceGroupCard } from "../../components/DeviceGroupCard"
import {
  type DeviceGroup,
  type OpenAttentionRequest,
  fetchRequestsOpen,
  fetchSessionsOpen,
  respondToRequest,
} from "../../lib/api"
import { useAuth } from "../../lib/auth-context"
import { useAttentionStore } from "../../lib/store"
import { useRealtime } from "../../lib/use-realtime"
import { crypto } from "../../lib/uuid"

export default function AttentionScreen() {
  const { signOut } = useAuth()
  const queryClient = useQueryClient()
  const { activeRequestId, setActiveRequestId, setRequestPending, isRequestPending } =
    useAttentionStore()

  // ── Realtime socket updates ─────────────────────────────────────────────────
  useRealtime()

  // ── Data fetching ──────────────────────────────────────────────────────────
  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    isRefetching: sessionsRefetching,
    refetch: refetchSessions,
  } = useQuery({
    queryKey: ["sessions", "open"],
    queryFn: fetchSessionsOpen,
  })

  const {
    data: requestsData,
    isLoading: requestsLoading,
    isRefetching: requestsRefetching,
    refetch: refetchRequests,
  } = useQuery({
    queryKey: ["requests", "open"],
    queryFn: fetchRequestsOpen,
  })

  const isLoading = sessionsLoading || requestsLoading
  const isRefreshing = sessionsRefetching || requestsRefetching

  const onRefresh = useCallback(() => {
    refetchSessions()
    refetchRequests()
  }, [refetchSessions, refetchRequests])

  // ── Action modal ───────────────────────────────────────────────────────────
  const activeRequest = requestsData?.requests.find((r) => r.request_id === activeRequestId) ?? null

  const handleBlockerPress = useCallback(
    (requestId: string) => {
      if (!isRequestPending(requestId)) {
        setActiveRequestId(requestId)
      }
    },
    [isRequestPending, setActiveRequestId],
  )

  const handleCloseModal = useCallback(() => {
    setActiveRequestId(null)
  }, [setActiveRequestId])

  const handleRespond = useCallback(
    async (requestId: string, decision: "once" | "always" | "reject") => {
      setRequestPending(requestId, true)
      setActiveRequestId(null)
      try {
        await respondToRequest(requestId, {
          type: "permission",
          decision,
          client_action_id: crypto.randomUUID(),
        })
        // Optimistically invalidate to refetch updated state
        queryClient.invalidateQueries({ queryKey: ["requests", "open"] })
        queryClient.invalidateQueries({ queryKey: ["sessions", "open"] })
      } catch (err) {
        const message =
          err instanceof Error && err.message.includes("PLUGIN_OFFLINE")
            ? "Device is offline. Reconnect and try again."
            : err instanceof Error
              ? err.message
              : "Failed to send response"
        Alert.alert("Action failed", message)
      } finally {
        setRequestPending(requestId, false)
      }
    },
    [setRequestPending, setActiveRequestId, queryClient],
  )

  const handleQuestionRespond = useCallback(
    async (requestId: string, answers: string[][]) => {
      setRequestPending(requestId, true)
      setActiveRequestId(null)
      try {
        await respondToRequest(requestId, {
          type: "question",
          answers,
          client_action_id: crypto.randomUUID(),
        })
        queryClient.invalidateQueries({ queryKey: ["requests", "open"] })
        queryClient.invalidateQueries({ queryKey: ["sessions", "open"] })
      } catch (err) {
        const message =
          err instanceof Error && err.message.includes("PLUGIN_OFFLINE")
            ? "Device is offline. Reconnect and try again."
            : err instanceof Error
              ? err.message
              : "Failed to send response"
        Alert.alert("Action failed", message)
      } finally {
        setRequestPending(requestId, false)
      }
    },
    [setRequestPending, setActiveRequestId, queryClient],
  )

  const handleQuestionReject = useCallback(
    async (requestId: string) => {
      setRequestPending(requestId, true)
      setActiveRequestId(null)
      try {
        await respondToRequest(requestId, {
          type: "question",
          decision: "reject",
          client_action_id: crypto.randomUUID(),
        })
        queryClient.invalidateQueries({ queryKey: ["requests", "open"] })
        queryClient.invalidateQueries({ queryKey: ["sessions", "open"] })
      } catch (err) {
        const message =
          err instanceof Error && err.message.includes("PLUGIN_OFFLINE")
            ? "Device is offline. Reconnect and try again."
            : err instanceof Error
              ? err.message
              : "Failed to send response"
        Alert.alert("Action failed", message)
      } finally {
        setRequestPending(requestId, false)
      }
    },
    [setRequestPending, setActiveRequestId, queryClient],
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  const groups: DeviceGroup[] = sessionsData?.groups ?? []
  const requests: OpenAttentionRequest[] = requestsData?.requests ?? []

  const totalOpenRequests = requests.filter((r) => r.status === "open").length

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Remocode</Text>
          {totalOpenRequests > 0 && (
            <Text style={styles.headerSubtitle}>
              {totalOpenRequests} action{totalOpenRequests !== 1 ? "s" : ""} needed
            </Text>
          )}
        </View>
        <TouchableOpacity onPress={signOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading sessions…</Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>💤</Text>
          <Text style={styles.emptyTitle}>No active sessions</Text>
          <Text style={styles.emptySubtitle}>
            Sessions will appear here when OpenCode is running
          </Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.device.id}
          renderItem={({ item }) => (
            <DeviceGroupCard group={item} requests={requests} onBlockerPress={handleBlockerPress} />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#3b82f6" />
          }
        />
      )}

      {/* Action modal */}
      <Modal
        visible={activeRequest !== null}
        transparent
        animationType="slide"
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {activeRequest && (
              <ActionSheet
                request={activeRequest}
                onClose={handleCloseModal}
                onPermissionRespond={handleRespond}
                onQuestionRespond={handleQuestionRespond}
                onQuestionReject={handleQuestionReject}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#020617",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#f8fafc",
  },
  headerSubtitle: {
    fontSize: 12,
    color: "#f59e0b",
    marginTop: 2,
    fontWeight: "500",
  },
  signOutButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#334155",
  },
  signOutText: {
    fontSize: 13,
    color: "#94a3b8",
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "#64748b",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#94a3b8",
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
  },
  listContent: {
    padding: 16,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#0f172a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },
})
