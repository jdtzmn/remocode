import * as Notifications from "expo-notifications"
import { useEffect, useRef } from "react"
import { AppState, type AppStateStatus, Platform } from "react-native"
import { registerPushToken } from "./api"
import { useAuth } from "./auth-context"

/**
 * Registers the device's Expo push token with the backend on mount and
 * whenever the app returns to the foreground while the user is authenticated.
 *
 * Silently ignores failures so a token registration error never breaks the app.
 */
export function usePushToken() {
  const { session } = useAuth()
  const registeredTokenRef = useRef<string | null>(null)

  useEffect(() => {
    if (!session) return

    async function register() {
      try {
        // Request notification permissions (iOS requires explicit request)
        const { status: existingStatus } = await Notifications.getPermissionsAsync()
        let finalStatus = existingStatus

        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync()
          finalStatus = status
        }

        if (finalStatus !== "granted") {
          // User denied notifications — skip silently
          return
        }

        // Get the Expo push token
        const tokenResponse = await Notifications.getExpoPushTokenAsync()
        const expoPushToken = tokenResponse.data

        // Avoid re-registering the same token in this session
        if (registeredTokenRef.current === expoPushToken) return

        await registerPushToken({
          expo_push_token: expoPushToken,
          platform: Platform.OS === "ios" ? "ios" : "android",
        })

        registeredTokenRef.current = expoPushToken
      } catch {
        // Silently ignore — push token registration is best-effort
      }
    }

    // Register on initial mount / session change
    register()

    // Re-register whenever app comes back to foreground
    function handleAppStateChange(nextState: AppStateStatus) {
      if (nextState === "active") {
        register()
      }
    }

    const subscription = AppState.addEventListener("change", handleAppStateChange)

    return () => {
      subscription.remove()
    }
  }, [session])
}
