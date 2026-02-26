import { Stack } from "expo-router"
import { Redirect } from "expo-router"
import { useAuth } from "../../lib/auth-context"
import { QueryProvider } from "../../lib/query-provider"
import { usePushToken } from "../../lib/use-push-token"

function AppInner() {
  // Register push token on mount and whenever session changes
  usePushToken()

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  )
}

export default function AppLayout() {
  const { session, isLoading } = useAuth()

  // Show nothing while loading to avoid flash
  if (isLoading) {
    return null
  }

  // Redirect to sign-in if not authenticated
  if (!session) {
    return <Redirect href="/(auth)/sign-in" />
  }

  return (
    <QueryProvider>
      <AppInner />
    </QueryProvider>
  )
}
