/**
 * Expo push notification sender.
 *
 * Responsible for:
 * - Fetching active push tokens for a user from DB
 * - Sending push notifications via Expo Push API
 * - Revoking push tokens that are no longer valid (DeviceNotRegistered)
 *
 * This is a pure interface layer — the engine decides whether to send;
 * this module handles the actual delivery.
 */

import { Expo } from "expo-server-sdk"

export type PushTokenRecord = {
  id: string
  expoPushToken: string
}

export type PushSenderStore = {
  /** Fetch active (non-revoked) push tokens for a user. */
  getActiveTokensForUser: (userId: string) => Promise<PushTokenRecord[]>
  /** Revoke a token that is no longer valid. */
  revokeToken: (tokenId: string) => Promise<void>
}

export type PushPayload = {
  title: string
  body: string
  data: Record<string, unknown>
}

export type PushSendResult = {
  sent: number
  failed: number
}

export type PushSender = {
  /**
   * Send a push notification to all active tokens for the given user.
   * Revokes tokens that Expo reports as DeviceNotRegistered.
   * Does NOT throw — errors are caught per-ticket.
   */
  sendToUser: (userId: string, payload: PushPayload) => Promise<PushSendResult>
}

export function createExpoPushSender(store: PushSenderStore, expoAccessToken?: string): PushSender {
  const expo = new Expo(expoAccessToken ? { accessToken: expoAccessToken } : undefined)

  return {
    sendToUser: async (userId, payload) => {
      let tokens: PushTokenRecord[]

      try {
        tokens = await store.getActiveTokensForUser(userId)
      } catch {
        // Fail-open: if we can't fetch tokens, skip sending
        return { sent: 0, failed: 0 }
      }

      if (tokens.length === 0) {
        return { sent: 0, failed: 0 }
      }

      // Filter to valid Expo push tokens
      const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t.expoPushToken))

      if (validTokens.length === 0) {
        return { sent: 0, failed: 0 }
      }

      const messages = validTokens.map((t) => ({
        to: t.expoPushToken,
        title: payload.title,
        body: payload.body,
        data: payload.data,
        sound: "default" as const,
        priority: "high" as const,
      }))

      let sent = 0
      let failed = 0

      // Chunk and send — Expo SDK handles batching
      const chunks = expo.chunkPushNotifications(messages)

      for (const chunk of chunks) {
        let tickets: Awaited<ReturnType<Expo["sendPushNotificationsAsync"]>>

        try {
          tickets = await expo.sendPushNotificationsAsync(chunk)
        } catch {
          // Entire chunk failed — count all as failed
          failed += chunk.length
          continue
        }

        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i]
          const tokenRecord = validTokens[i]

          if (ticket.status === "ok") {
            sent++
          } else {
            failed++

            // Revoke tokens that Expo says are no longer registered
            if (
              ticket.status === "error" &&
              ticket.details?.error === "DeviceNotRegistered" &&
              tokenRecord
            ) {
              try {
                await store.revokeToken(tokenRecord.id)
              } catch {
                // Revocation failure is non-fatal
              }
            }
          }
        }
      }

      return { sent, failed }
    },
  }
}
