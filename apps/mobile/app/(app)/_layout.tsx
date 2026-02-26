import { Stack } from "expo-router"
import { Redirect } from "expo-router"
import { useAuth } from "../../lib/auth-context"
import { QueryProvider } from "../../lib/query-provider"

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
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </QueryProvider>
  )
}
