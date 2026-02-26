import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { type CreatePatResponse, type Pat, createPat, fetchPats, revokePat } from "../../lib/api"
import { useAuth } from "../../lib/auth-context"
import { usePushToken } from "../../lib/use-push-token"

// ── PAT Item ─────────────────────────────────────────────────────────────────

function PatItem({ pat, onRevoke }: { pat: Pat; onRevoke: (id: string) => void }) {
  function handleRevoke() {
    Alert.alert("Revoke token", `Revoke "${pat.label}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: () => onRevoke(pat.id),
      },
    ])
  }

  const lastUsed = pat.last_used_at ? new Date(pat.last_used_at).toLocaleDateString() : "Never used"

  const created = new Date(pat.created_at).toLocaleDateString()

  return (
    <View style={styles.patItem}>
      <View style={styles.patInfo}>
        <Text style={styles.patLabel}>{pat.label}</Text>
        <Text style={styles.patMeta}>
          {pat.token_prefix}… · Created {created}
        </Text>
        <Text style={styles.patMeta}>Last used: {lastUsed}</Text>
      </View>
      <TouchableOpacity onPress={handleRevoke} style={styles.revokeButton}>
        <Text style={styles.revokeText}>Revoke</Text>
      </TouchableOpacity>
    </View>
  )
}

// ── Create PAT Modal ──────────────────────────────────────────────────────────

function CreatePatModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean
  onClose: () => void
  onCreate: (label: string) => void
}) {
  const [label, setLabel] = useState("")

  function handleCreate() {
    const trimmed = label.trim()
    if (!trimmed) {
      Alert.alert("Label required", "Please enter a name for this token.")
      return
    }
    onCreate(trimmed)
    setLabel("")
  }

  function handleClose() {
    setLabel("")
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>New access token</Text>
          <Text style={styles.modalSubtitle}>
            Give this token a name so you can identify it later (e.g. "work-mac").
          </Text>
          <TextInput
            style={styles.textInput}
            placeholder="Token label"
            placeholderTextColor="#475569"
            value={label}
            onChangeText={setLabel}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCreate} style={styles.createButton}>
              <Text style={styles.createText}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ── Show Token Modal ──────────────────────────────────────────────────────────

function ShowTokenModal({
  result,
  onClose,
}: {
  result: CreatePatResponse | null
  onClose: () => void
}) {
  return (
    <Modal visible={result !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Token created</Text>
          <Text style={styles.tokenWarning}>Copy this token now — it will not be shown again.</Text>
          <View style={styles.tokenBox}>
            <Text style={styles.tokenText} selectable>
              {result?.token}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={[styles.createButton, styles.fullWidth]}>
            <Text style={styles.createText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

// ── Settings Screen ───────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { signOut } = useAuth()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [createdToken, setCreatedToken] = useState<CreatePatResponse | null>(null)

  // Re-register push token on every visit so status is fresh
  usePushToken()

  // ── PAT list ────────────────────────────────────────────────────────────────
  const {
    data: patsData,
    isLoading: patsLoading,
    isError: patsError,
    refetch: refetchPats,
  } = useQuery({
    queryKey: ["pats"],
    queryFn: fetchPats,
  })

  // ── Create PAT ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (label: string) => createPat({ label }),
    onSuccess: (data) => {
      setShowCreate(false)
      setCreatedToken(data)
      queryClient.invalidateQueries({ queryKey: ["pats"] })
    },
    onError: () => {
      Alert.alert("Error", "Failed to create token. Please try again.")
    },
  })

  // ── Revoke PAT ──────────────────────────────────────────────────────────────
  const revokeMutation = useMutation({
    mutationFn: (patId: string) => revokePat(patId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pats"] })
    },
    onError: () => {
      Alert.alert("Error", "Failed to revoke token. Please try again.")
    },
  })

  const handleCreate = useCallback(
    (label: string) => {
      createMutation.mutate(label)
    },
    [createMutation],
  )

  const handleRevoke = useCallback(
    (patId: string) => {
      revokeMutation.mutate(patId)
    },
    [revokeMutation],
  )

  const pats = patsData?.pats ?? []

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
        <TouchableOpacity onPress={signOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={pats}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <>
            {/* PAT section header */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Access tokens</Text>
              <TouchableOpacity
                onPress={() => setShowCreate(true)}
                style={styles.addButton}
                disabled={createMutation.isPending}
              >
                <Text style={styles.addText}>+ New token</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionDesc}>
              Personal access tokens let the OpenCode plugin authenticate with the backend. Each
              token is shown only once at creation.
            </Text>

            {/* Loading / error */}
            {patsLoading && (
              <View style={styles.centeredRow}>
                <ActivityIndicator size="small" color="#3b82f6" />
                <Text style={styles.loadingText}>Loading tokens…</Text>
              </View>
            )}
            {patsError && (
              <View style={styles.centeredRow}>
                <Text style={styles.errorText}>Failed to load tokens.</Text>
                <TouchableOpacity onPress={() => refetchPats()}>
                  <Text style={styles.retryText}> Retry</Text>
                </TouchableOpacity>
              </View>
            )}
            {!patsLoading && !patsError && pats.length === 0 && (
              <View style={styles.emptyPats}>
                <Text style={styles.emptyPatsText}>
                  No tokens yet. Create one to connect the plugin.
                </Text>
              </View>
            )}
          </>
        }
        renderItem={({ item }) => <PatItem pat={item} onRevoke={handleRevoke} />}
        contentContainerStyle={styles.listContent}
        ListFooterComponent={
          <>
            {/* Push notification status section */}
            <View style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>
              <Text style={styles.sectionTitle}>Push notifications</Text>
            </View>
            <View style={styles.pushStatusCard}>
              <Text style={styles.pushStatusText}>
                Push notifications are registered automatically when the app launches. If you are
                not receiving notifications, check your device notification permissions in iOS
                Settings.
              </Text>
            </View>

            {/* Sign out section */}
            <View style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>
              <Text style={styles.sectionTitle}>Account</Text>
            </View>
            <TouchableOpacity onPress={signOut} style={styles.signOutRow}>
              <Text style={styles.signOutRowText}>Sign out</Text>
            </TouchableOpacity>
          </>
        }
      />

      {/* Create PAT modal */}
      <CreatePatModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
      />

      {/* Show new token modal */}
      <ShowTokenModal result={createdToken} onClose={() => setCreatedToken(null)} />
    </SafeAreaView>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────────

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
  listContent: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  sectionHeaderSpaced: {
    marginTop: 32,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionDesc: {
    fontSize: 13,
    color: "#475569",
    marginBottom: 12,
    lineHeight: 18,
  },
  addButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "#1e3a5f",
    borderRadius: 6,
  },
  addText: {
    fontSize: 13,
    color: "#60a5fa",
    fontWeight: "600",
  },
  centeredRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 13,
    color: "#64748b",
    marginLeft: 8,
  },
  errorText: {
    fontSize: 13,
    color: "#ef4444",
  },
  retryText: {
    fontSize: 13,
    color: "#3b82f6",
  },
  emptyPats: {
    paddingVertical: 16,
    alignItems: "center",
  },
  emptyPatsText: {
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
  },
  patItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f172a",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  patInfo: {
    flex: 1,
    gap: 2,
  },
  patLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#f1f5f9",
  },
  patMeta: {
    fontSize: 12,
    color: "#64748b",
  },
  revokeButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    marginLeft: 12,
  },
  revokeText: {
    fontSize: 12,
    color: "#f87171",
    fontWeight: "600",
  },
  pushStatusCard: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  pushStatusText: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 18,
  },
  signOutRow: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1e293b",
    alignItems: "center",
  },
  signOutRowText: {
    fontSize: 15,
    color: "#ef4444",
    fontWeight: "600",
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
    padding: 24,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f8fafc",
  },
  modalSubtitle: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 18,
  },
  textInput: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    color: "#f1f5f9",
    fontSize: 15,
    padding: 12,
    marginTop: 4,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
    alignItems: "center",
  },
  cancelText: {
    fontSize: 15,
    color: "#94a3b8",
    fontWeight: "500",
  },
  createButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#3b82f6",
    alignItems: "center",
  },
  createText: {
    fontSize: 15,
    color: "#ffffff",
    fontWeight: "600",
  },
  fullWidth: {
    flex: 0,
    width: "100%",
  },
  tokenWarning: {
    fontSize: 13,
    color: "#f59e0b",
    fontWeight: "500",
  },
  tokenBox: {
    backgroundColor: "#1e293b",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  tokenText: {
    fontSize: 13,
    color: "#a3e635",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
  },
})
