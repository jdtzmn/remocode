import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import type { OpenAttentionRequest } from "../lib/api"

interface BlockerCardProps {
  request: OpenAttentionRequest
  isPending: boolean
  onPress: (requestId: string) => void
}

export function BlockerCard({ request, isPending, onPress }: BlockerCardProps) {
  const isPermission = request.kind === "permission"
  const payload = request.payload

  const title = isPermission
    ? `Permission: ${(payload.permission as string) ?? "Unknown"}`
    : `Question: ${getQuestionHeader(payload)}`

  const subtitle = isPermission ? getPermissionPatterns(payload) : getQuestionText(payload)

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => onPress(request.request_id)}
      disabled={isPending}
      activeOpacity={0.75}
    >
      <View style={styles.header}>
        <View
          style={[styles.kindBadge, isPermission ? styles.permissionBadge : styles.questionBadge]}
        >
          <Text style={styles.kindText}>{isPermission ? "PERMISSION" : "QUESTION"}</Text>
        </View>
        {isPending ? (
          <ActivityIndicator size="small" color="#94a3b8" />
        ) : (
          <Text style={styles.actionHint}>Tap to respond →</Text>
        )}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
    </TouchableOpacity>
  )
}

function getPermissionPatterns(payload: Record<string, unknown>): string {
  const patterns = payload.patterns
  if (!Array.isArray(patterns) || patterns.length === 0) return ""
  return patterns.slice(0, 3).join(", ")
}

function getQuestionHeader(payload: Record<string, unknown>): string {
  const questions = payload.questions
  if (!Array.isArray(questions) || questions.length === 0) return "Response needed"
  const first = questions[0] as Record<string, unknown>
  return (first.header as string) ?? "Response needed"
}

function getQuestionText(payload: Record<string, unknown>): string {
  const questions = payload.questions
  if (!Array.isArray(questions) || questions.length === 0) return ""
  const first = questions[0] as Record<string, unknown>
  return (first.question as string) ?? ""
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#f59e0b",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  kindBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  permissionBadge: {
    backgroundColor: "#78350f",
  },
  questionBadge: {
    backgroundColor: "#1e3a5f",
  },
  kindText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fcd34d",
    letterSpacing: 0.5,
  },
  actionHint: {
    fontSize: 11,
    color: "#64748b",
  },
  title: {
    fontSize: 13,
    fontWeight: "600",
    color: "#f1f5f9",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: "monospace",
  },
})
