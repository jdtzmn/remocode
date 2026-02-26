import { StyleSheet, Text, View } from "react-native"
import type { OpenAttentionRequest, SessionSummary } from "../lib/api"
import { useAttentionStore } from "../lib/store"
import { BlockerCard } from "./BlockerCard"

interface SessionCardProps {
  session: SessionSummary
  requests: OpenAttentionRequest[]
  onBlockerPress: (requestId: string) => void
}

export function SessionCard({ session, requests, onBlockerPress }: SessionCardProps) {
  const { isRequestPending } = useAttentionStore()
  const openRequests = requests.filter(
    (r) => r.session_id === session.session_id && r.status === "open",
  )

  return (
    <View style={[styles.container, session.is_stale && styles.staleContainer]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={[styles.stateDot, stateColors[session.state]]} />
          <Text style={[styles.title, session.is_stale && styles.staleTitle]} numberOfLines={1}>
            {session.title}
          </Text>
        </View>
        {session.attention_count > 0 && (
          <View style={styles.attentionBadge}>
            <Text style={styles.attentionBadgeText}>{session.attention_count}</Text>
          </View>
        )}
      </View>

      <View style={styles.meta}>
        <Text style={styles.stateLabel}>{stateLabels[session.state]}</Text>
        {session.is_stale && <Text style={styles.staleLabel}>• stale</Text>}
      </View>

      {/* Inline blocker cards, attention-first */}
      {openRequests.map((req) => (
        <BlockerCard
          key={req.request_id}
          request={req}
          isPending={isRequestPending(req.request_id)}
          onPress={onBlockerPress}
        />
      ))}
    </View>
  )
}

const stateColors: Record<SessionSummary["state"], object> = {
  busy: { backgroundColor: "#22c55e" },
  retry: { backgroundColor: "#f59e0b" },
  idle: { backgroundColor: "#64748b" },
  unknown: { backgroundColor: "#374151" },
}

const stateLabels: Record<SessionSummary["state"], string> = {
  busy: "Busy",
  retry: "Retrying",
  idle: "Idle",
  unknown: "Unknown",
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#0f1a2b",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  staleContainer: {
    opacity: 0.6,
    borderColor: "#1e293b",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
    flexShrink: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#f1f5f9",
    flex: 1,
  },
  staleTitle: {
    color: "#64748b",
  },
  attentionBadge: {
    backgroundColor: "#f59e0b",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  attentionBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0f172a",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 4,
  },
  stateLabel: {
    fontSize: 11,
    color: "#64748b",
  },
  staleLabel: {
    fontSize: 11,
    color: "#475569",
  },
})
