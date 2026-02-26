import { describe, expect, it, vi } from "vitest"

import { ApiHttpError } from "../http/errors"
import { createPatAuthenticator, hashPatSecret, verifyPatSecret } from "./pat"

describe("pat auth", () => {
  it("hashes and verifies token secrets", () => {
    const pepper = "pepper"
    const secret = "secret"
    const digest = hashPatSecret(secret, pepper)

    expect(digest.startsWith("sha256:")).toBe(true)
    expect(verifyPatSecret(secret, digest, pepper)).toBe(true)
    expect(verifyPatSecret("wrong", digest, pepper)).toBe(false)
  })

  it("authenticates active tokens and updates last_used_at", async () => {
    const pepper = "pepper"
    const markPatUsedAt = vi.fn(async () => undefined)
    const authenticate = createPatAuthenticator({
      pepper,
      findPatByPrefix: async () => ({
        id: "pat-1",
        userId: "user-1",
        tokenPrefix: "prefix-1",
        secretHash: hashPatSecret("secret", pepper),
        revokedAt: null,
      }),
      markPatUsedAt,
    })

    const auth = await authenticate("pat_prefix-1_secret")

    expect(auth).toEqual({
      userId: "user-1",
      patId: "pat-1",
      tokenPrefix: "prefix-1",
    })
    expect(markPatUsedAt).toHaveBeenCalledTimes(1)
    expect(markPatUsedAt).toHaveBeenCalledWith("pat-1", expect.any(Date))
  })

  it("rejects malformed PAT values", async () => {
    const authenticate = createPatAuthenticator({
      pepper: "pepper",
      findPatByPrefix: async () => null,
      markPatUsedAt: async () => undefined,
    })

    await expect(authenticate("invalid")).rejects.toBeInstanceOf(ApiHttpError)
  })

  it("rejects revoked and invalid secrets", async () => {
    const pepper = "pepper"

    const revokedAuthenticate = createPatAuthenticator({
      pepper,
      findPatByPrefix: async () => ({
        id: "pat-1",
        userId: "user-1",
        tokenPrefix: "prefix-1",
        secretHash: hashPatSecret("secret", pepper),
        revokedAt: new Date(),
      }),
      markPatUsedAt: async () => undefined,
    })

    await expect(revokedAuthenticate("pat_prefix-1_secret")).rejects.toBeInstanceOf(ApiHttpError)

    const invalidSecretAuthenticate = createPatAuthenticator({
      pepper,
      findPatByPrefix: async () => ({
        id: "pat-1",
        userId: "user-1",
        tokenPrefix: "prefix-1",
        secretHash: hashPatSecret("secret", pepper),
        revokedAt: null,
      }),
      markPatUsedAt: async () => undefined,
    })

    await expect(invalidSecretAuthenticate("pat_prefix-1_wrong")).rejects.toBeInstanceOf(
      ApiHttpError,
    )
  })
})
