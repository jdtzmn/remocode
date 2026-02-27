import * as Linking from "expo-linking"
import { Stack } from "expo-router"
import { useRouter, useSegments } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useEffect } from "react"
import { AuthProvider, useAuth } from "../lib/auth-context"
import { supabase } from "../lib/supabase"

function RootLayoutNav() {
  const { session, isLoading } = useAuth()
  const segments = useSegments()
  const router = useRouter()

  // Handle OAuth deep link callback (remocode://auth/callback#access_token=...)
  useEffect(() => {
    const handleUrl = async (url: string) => {
      const fragmentString = url.includes("#") ? url.split("#")[1] : ""
      const params = new URLSearchParams(fragmentString)
      const accessToken = params.get("access_token")
      const refreshToken = params.get("refresh_token")
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      }
    }

    // Handle URL that launched the app
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url)
    })

    // Handle URL while app is running
    const subscription = Linking.addEventListener("url", ({ url }) => handleUrl(url))
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (isLoading) return

    const inAuthGroup = segments[0] === "(auth)"

    if (!session && !inAuthGroup) {
      // Redirect to sign-in if not authenticated
      router.replace("/(auth)/sign-in")
    } else if (session && inAuthGroup) {
      // Redirect to main app if already authenticated
      router.replace("/(app)")
    }
  }, [session, isLoading, segments, router])

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
      <StatusBar style="auto" />
    </>
  )
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  )
}
