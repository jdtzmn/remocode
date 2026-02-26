// Minimal UUID v4 generator for React Native
// Expo SDK ships with expo-crypto which provides randomBytes, but we can also
// use the global crypto if available (Hermes / JSC on newer Expo).

function generateUUID(): string {
  // Use global crypto if available (Expo SDK 48+ / React Native 0.71+)
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID()
  }

  // Fallback: manual UUID v4 construction using Math.random
  // This is not cryptographically secure but acceptable for client_action_id usage
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export const crypto = {
  randomUUID: generateUUID,
}
