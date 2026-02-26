import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import type { DeviceGroup, OpenAttentionRequest } from "../lib/api"
import { useAttentionStore } from "../lib/store"
import { SessionCard } from "./SessionCard"

interface DeviceGroupCardProps {
  group: DeviceGroup
  requests: OpenAttentionRequest[]
  onBlockerPress: (requestId: string) => void
}

export function DeviceGroupCard({ group, requests, onBlockerPress }: DeviceGroupCardProps) {
  const { expandedDeviceIds, toggleDeviceExpanded } = useAttentionStore()
  const deviceId = group.device.id
  const isExpanded = expandedDeviceIds.has(deviceId)

  // Count open requests for this device
  const deviceRequestIds = new Set(
    requests
      .filter((r) => r.device_id === deviceId && r.status === "open")
      .map((r) => r.request_id),
  )

  // Total attention count across all sessions in group
  const totalAttentionCount = group.sessions.reduce((sum, s) => sum + s.attention_count, 0)

  const deviceName = group.device.name ?? "Unknown Device"
  const platform = group.device.platform ?? ""
  const activity = group.device.activity
  const isActive = activity?.is_active
  const idleSeconds = activity?.idle_seconds

  const activityLabel =
    isActive === null || isActive === undefined
      ? "Activity unknown"
      : isActive
        ? "Active"
        : idleSeconds != null
          ? `Idle ${formatIdleTime(idleSeconds)}`
          : "Inactive"

  return (
    <View style={styles.container}>
      {/* Device header */}
      <TouchableOpacity
        style={styles.deviceHeader}
        onPress={() => toggleDeviceExpanded(deviceId)}
        activeOpacity={0.7}
      >
        <View style={styles.deviceInfo}>
          <View style={styles.deviceTitleRow}>
            <Text style={styles.deviceIcon}>{platformIcon(platform)}</Text>
            <Text style={styles.deviceName}>{deviceName}</Text>
            {totalAttentionCount > 0 && (
              <View style={styles.deviceAttentionBadge}>
                <Text style={styles.deviceAttentionText}>{totalAttentionCount}</Text>
              </View>
            )}
          </View>
          <View style={styles.deviceMeta}>
            <View style={[styles.activityDot, isActive ? styles.activeDot : styles.inactiveDot]} />
            <Text style={styles.activityLabel}>{activityLabel}</Text>
            <Text style={styles.sessionCount}>
              {" "}
              · {group.sessions.length} session{group.sessions.length !== 1 ? "s" : ""}
            </Text>
          </View>
        </View>
        <Text style={styles.chevron}>{isExpanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>

      {/* Sessions list (shown when expanded or when there are blockers) */}
      {(isExpanded || deviceRequestIds.size > 0) && (
        <View style={styles.sessionsContainer}>
          {group.sessions.map((session) => (
            <SessionCard
              key={session.session_id}
              session={session}
              requests={requests}
              onBlockerPress={onBlockerPress}
            />
          ))}
        </View>
      )}
    </View>
  )
}

function platformIcon(platform: string): string {
  if (platform === "darwin") return "🍎"
  if (platform === "win32") return "🪟"
  if (platform === "linux") return "🐧"
  return "💻"
}

function formatIdleTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  return `${hours}h ${mins % 60}m`
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  deviceHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  deviceIcon: {
    fontSize: 16,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#f8fafc",
    flex: 1,
  },
  deviceAttentionBadge: {
    backgroundColor: "#f59e0b",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  deviceAttentionText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0f172a",
  },
  deviceMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 4,
  },
  activityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  activeDot: {
    backgroundColor: "#22c55e",
  },
  inactiveDot: {
    backgroundColor: "#475569",
  },
  activityLabel: {
    fontSize: 12,
    color: "#94a3b8",
  },
  sessionCount: {
    fontSize: 12,
    color: "#64748b",
  },
  chevron: {
    fontSize: 12,
    color: "#475569",
    marginLeft: 8,
  },
  sessionsContainer: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
})
