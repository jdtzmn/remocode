import * as Linking from "expo-linking"
import * as WebBrowser from "expo-web-browser"
import React, { useState } from "react"
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { supabase } from "../../lib/supabase"

WebBrowser.maybeCompleteAuthSession()

const redirectTo = Linking.createURL("auth/callback")

export default function SignInScreen() {
  const [loading, setLoading] = useState(false)

  async function signInWithGoogle() {
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      })

      if (error) throw error

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)

      if (result.type === "success") {
        const url = result.url
        // Extract tokens from the URL fragment
        const fragmentString = url.includes("#") ? url.split("#")[1] : ""
        const params = new URLSearchParams(fragmentString)
        const accessToken = params.get("access_token")
        const refreshToken = params.get("refresh_token")

        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (sessionError) throw sessionError
        } else {
          // Some Supabase setups use query params instead of fragment
          const urlObj = new URL(url)
          const qAccessToken = urlObj.searchParams.get("access_token")
          const qRefreshToken = urlObj.searchParams.get("refresh_token")
          if (qAccessToken && qRefreshToken) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: qAccessToken,
              refresh_token: qRefreshToken,
            })
            if (sessionError) throw sessionError
          }
        }
      }
    } catch (err) {
      Alert.alert("Sign In Error", err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>remocode</Text>
          <Text style={styles.subtitle}>Coding session attention system</Text>
        </View>

        {/* Google Sign In Button */}
        <TouchableOpacity
          style={[styles.googleButton, loading && styles.buttonDisabled]}
          onPress={signInWithGoogle}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#1f2937" />
          ) : (
            <>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  header: {
    alignItems: "center",
    marginBottom: 48,
  },
  logo: {
    fontSize: 32,
    fontWeight: "700",
    color: "#f8fafc",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 8,
  },
  googleButton: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  googleIcon: {
    fontSize: 16,
    fontWeight: "700",
    color: "#4285F4",
  },
  googleButtonText: {
    color: "#1f2937",
    fontSize: 16,
    fontWeight: "600",
  },
})
