import { useState } from "react"
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native"
import type { OpenAttentionRequest } from "../lib/api"

// ─── Types ──────────────────────────────────────────────────────────────────

interface QuestionInfo {
  header: string
  question: string
  options: Array<{ label: string; description?: string }>
  multiple?: boolean
  custom?: boolean
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ActionSheetProps {
  request: OpenAttentionRequest
  onClose: () => void
  onPermissionRespond: (requestId: string, decision: "once" | "always" | "reject") => void
  onQuestionRespond: (requestId: string, answers: string[][]) => void
  onQuestionReject: (requestId: string) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ActionSheet({
  request,
  onClose,
  onPermissionRespond,
  onQuestionRespond,
  onQuestionReject,
}: ActionSheetProps) {
  if (request.kind === "permission") {
    return (
      <PermissionActionSheet request={request} onClose={onClose} onRespond={onPermissionRespond} />
    )
  }

  return (
    <QuestionActionSheet
      request={request}
      onClose={onClose}
      onRespond={onQuestionRespond}
      onReject={onQuestionReject}
    />
  )
}

// ─── Permission Action Sheet ─────────────────────────────────────────────────

interface PermissionActionSheetProps {
  request: OpenAttentionRequest
  onClose: () => void
  onRespond: (requestId: string, decision: "once" | "always" | "reject") => void
}

function PermissionActionSheet({ request, onClose, onRespond }: PermissionActionSheetProps) {
  const payload = request.payload
  const permission = (payload.permission as string) ?? "Unknown"
  const patterns = (payload.patterns as string[]) ?? []
  const always = (payload.always as string[]) ?? []

  return (
    <View>
      {/* Header */}
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>Permission Request</Text>
        <TouchableOpacity onPress={onClose} style={styles.sheetCloseButton} hitSlop={8}>
          <Text style={styles.sheetCloseText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      <ScrollView style={styles.sheetScrollBody} contentContainerStyle={styles.sheetBody}>
        <Text style={styles.sheetPermissionType}>{permission}</Text>

        {patterns.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Patterns</Text>
            <View style={styles.sheetPatterns}>
              {patterns.map((p) => (
                <View key={p} style={styles.sheetPatternChip}>
                  <Text style={styles.sheetPatternText}>{p}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {always.length > 0 && (
          <Text style={styles.sheetAlwaysHint}>Always allowed: {always.join(", ")}</Text>
        )}
      </ScrollView>

      {/* Actions */}
      <View style={styles.sheetActions}>
        <TouchableOpacity
          style={[styles.sheetButton, styles.buttonAllowOnce]}
          onPress={() => onRespond(request.request_id, "once")}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Allow once</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sheetButton, styles.buttonAllowRun]}
          onPress={() => onRespond(request.request_id, "always")}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Allow for this run</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sheetButton, styles.buttonReject]}
          onPress={() => onRespond(request.request_id, "reject")}
          activeOpacity={0.8}
        >
          <Text style={[styles.buttonText, styles.buttonRejectText]}>Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ─── Question Action Sheet ────────────────────────────────────────────────────

interface QuestionActionSheetProps {
  request: OpenAttentionRequest
  onClose: () => void
  onRespond: (requestId: string, answers: string[][]) => void
  onReject: (requestId: string) => void
}

function QuestionActionSheet({ request, onClose, onRespond, onReject }: QuestionActionSheetProps) {
  const payload = request.payload
  const questions = (payload.questions as QuestionInfo[]) ?? []
  const first = questions[0]

  // State: selected labels per question index + custom text
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set())
  const [customText, setCustomText] = useState("")

  const allowsMultiple = first?.multiple === true
  const allowsCustom = first?.custom === true

  const toggleOption = (label: string) => {
    setSelectedLabels((prev) => {
      if (allowsMultiple) {
        const next = new Set(prev)
        if (next.has(label)) {
          next.delete(label)
        } else {
          next.add(label)
        }
        return next
      }
      // Single select: immediately submit
      onRespond(request.request_id, [[label]])
      return prev
    })
  }

  const handleSubmitMultiple = () => {
    const answers: string[] = []
    for (const label of selectedLabels) {
      answers.push(label)
    }
    if (allowsCustom && customText.trim()) {
      answers.push(customText.trim())
    }
    if (answers.length > 0) {
      onRespond(request.request_id, [answers])
    }
  }

  const handleSubmitCustomOnly = () => {
    const text = customText.trim()
    if (text) {
      onRespond(request.request_id, [[text]])
    }
  }

  if (!first) {
    return (
      <View>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Question</Text>
          <TouchableOpacity onPress={onClose} style={styles.sheetCloseButton} hitSlop={8}>
            <Text style={styles.sheetCloseText}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.sheetBody}>
          <Text style={styles.sheetQuestion}>No question data available.</Text>
        </View>
        <View style={styles.sheetActions}>
          <TouchableOpacity
            style={[styles.sheetButton, styles.buttonReject]}
            onPress={() => onReject(request.request_id)}
          >
            <Text style={[styles.buttonText, styles.buttonRejectText]}>Reject</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View>
      {/* Header */}
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{first.header}</Text>
        <TouchableOpacity onPress={onClose} style={styles.sheetCloseButton} hitSlop={8}>
          <Text style={styles.sheetCloseText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      <ScrollView style={styles.sheetScrollBody} contentContainerStyle={styles.sheetBody}>
        <Text style={styles.sheetQuestion}>{first.question}</Text>

        {/* Option tiles */}
        {first.options.map((opt) => {
          const isSelected = selectedLabels.has(opt.label)
          return (
            <TouchableOpacity
              key={opt.label}
              style={[styles.sheetOption, isSelected && styles.sheetOptionSelected]}
              onPress={() => toggleOption(opt.label)}
              activeOpacity={0.75}
            >
              <View style={styles.sheetOptionRow}>
                <Text
                  style={[styles.sheetOptionLabel, isSelected && styles.sheetOptionLabelSelected]}
                >
                  {opt.label}
                </Text>
                {allowsMultiple && (
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                )}
              </View>
              {opt.description ? (
                <Text style={styles.sheetOptionDesc}>{opt.description}</Text>
              ) : null}
            </TouchableOpacity>
          )
        })}

        {/* Custom text input */}
        {allowsCustom && (
          <View style={styles.customInputContainer}>
            <TextInput
              style={styles.customInput}
              placeholder="Type a custom answer…"
              placeholderTextColor="#475569"
              value={customText}
              onChangeText={setCustomText}
              multiline={false}
              returnKeyType="done"
              onSubmitEditing={allowsMultiple ? undefined : handleSubmitCustomOnly}
            />
          </View>
        )}
      </ScrollView>

      {/* Actions */}
      <View style={styles.sheetActions}>
        {/* Multi-select submit: show if multiple or custom-only without options */}
        {(allowsMultiple || (allowsCustom && first.options.length === 0)) && (
          <TouchableOpacity
            style={[
              styles.sheetButton,
              styles.buttonAllowOnce,
              selectedLabels.size === 0 && !customText.trim() && styles.buttonDisabled,
            ]}
            onPress={allowsMultiple ? handleSubmitMultiple : handleSubmitCustomOnly}
            disabled={selectedLabels.size === 0 && !customText.trim()}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>Submit</Text>
          </TouchableOpacity>
        )}

        {/* Custom-only submit when there are options but also custom allowed */}
        {allowsCustom &&
          !allowsMultiple &&
          first.options.length > 0 &&
          customText.trim().length > 0 && (
            <TouchableOpacity
              style={[styles.sheetButton, styles.buttonAllowOnce]}
              onPress={handleSubmitCustomOnly}
              activeOpacity={0.8}
            >
              <Text style={styles.buttonText}>Submit: "{customText.trim()}"</Text>
            </TouchableOpacity>
          )}

        <TouchableOpacity
          style={[styles.sheetButton, styles.buttonReject]}
          onPress={() => onReject(request.request_id)}
          activeOpacity={0.8}
        >
          <Text style={[styles.buttonText, styles.buttonRejectText]}>Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheetScrollBody: {
    maxHeight: 320,
  },
  sheetBody: {
    padding: 20,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#f8fafc",
    flex: 1,
    marginRight: 12,
  },
  sheetCloseButton: {
    padding: 4,
  },
  sheetCloseText: {
    fontSize: 16,
    color: "#64748b",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748b",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 6,
    marginTop: 4,
  },
  sheetPermissionType: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fcd34d",
    marginBottom: 16,
    fontFamily: "monospace",
  },
  sheetPatterns: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
  },
  sheetPatternChip: {
    backgroundColor: "#1e293b",
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#334155",
  },
  sheetPatternText: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: "monospace",
  },
  sheetAlwaysHint: {
    fontSize: 12,
    color: "#475569",
    marginTop: 4,
    lineHeight: 18,
  },
  sheetQuestion: {
    fontSize: 15,
    color: "#e2e8f0",
    marginBottom: 16,
    lineHeight: 22,
  },
  sheetOption: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  sheetOptionSelected: {
    borderColor: "#3b82f6",
    backgroundColor: "#1e3a5f",
  },
  sheetOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetOptionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#f1f5f9",
    flex: 1,
  },
  sheetOptionLabelSelected: {
    color: "#93c5fd",
  },
  sheetOptionDesc: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 4,
    lineHeight: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#475569",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  checkboxSelected: {
    borderColor: "#3b82f6",
    backgroundColor: "#3b82f6",
  },
  checkmark: {
    fontSize: 12,
    color: "#fff",
    fontWeight: "700",
  },
  customInputContainer: {
    marginTop: 8,
    backgroundColor: "#1e293b",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  customInput: {
    fontSize: 14,
    color: "#f1f5f9",
    paddingVertical: 10,
    minHeight: 40,
  },
  sheetActions: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
    gap: 10,
  },
  sheetButton: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonAllowOnce: {
    backgroundColor: "#166534",
  },
  buttonAllowRun: {
    backgroundColor: "#1d4ed8",
  },
  buttonReject: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#374151",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#f8fafc",
  },
  buttonRejectText: {
    color: "#f87171",
  },
})
