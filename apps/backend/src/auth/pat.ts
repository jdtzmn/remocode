import { createHash, timingSafeEqual } from "node:crypto"

import { ApiHttpError } from "../http/errors"
import type { PluginAuthContext } from "./types"

const PAT_TOKEN_REGEX = /^pat_([^_]+)_(.+)$/

export type PersonalAccessTokenRecord = {
  id: string
  userId: string
  tokenPrefix: string
  secretHash: string
  revokedAt: Date | null
}

type PatLookup = (tokenPrefix: string) => Promise<PersonalAccessTokenRecord | null>
type PatLastUsedUpdater = (patId: string, usedAt: Date) => Promise<void>

export type PatAuthenticator = (token: string) => Promise<PluginAuthContext>

type ParsedPatToken = {
  tokenPrefix: string
  secret: string
}

function parsePatToken(token: string): ParsedPatToken {
  const match = PAT_TOKEN_REGEX.exec(token)

  if (!match) {
    throw new ApiHttpError("UNAUTHORIZED", {
      message: "Invalid personal access token",
    })
  }

  return {
    tokenPrefix: match[1],
    secret: match[2],
  }
}

function hashPatSecretDigest(secret: string, pepper: string) {
  return createHash("sha256").update(`${pepper}:${secret}`).digest("hex")
}

export function hashPatSecret(secret: string, pepper: string) {
  return `sha256:${hashPatSecretDigest(secret, pepper)}`
}

export function verifyPatSecret(secret: string, storedHash: string, pepper: string) {
  const storedDigest = storedHash.startsWith("sha256:")
    ? storedHash.slice("sha256:".length)
    : storedHash
  const expectedDigest = hashPatSecretDigest(secret, pepper)

  const storedBuffer = Buffer.from(storedDigest)
  const expectedBuffer = Buffer.from(expectedDigest)

  if (storedBuffer.length !== expectedBuffer.length) {
    return false
  }

  return timingSafeEqual(storedBuffer, expectedBuffer)
}

export function createPatAuthenticator(options: {
  findPatByPrefix: PatLookup
  markPatUsedAt: PatLastUsedUpdater
  pepper: string
}): PatAuthenticator {
  return async (token) => {
    const { tokenPrefix, secret } = parsePatToken(token)
    const pat = await options.findPatByPrefix(tokenPrefix)

    if (!pat || pat.revokedAt) {
      throw new ApiHttpError("UNAUTHORIZED", {
        message: "Invalid personal access token",
      })
    }

    const isValidSecret = verifyPatSecret(secret, pat.secretHash, options.pepper)

    if (!isValidSecret) {
      throw new ApiHttpError("UNAUTHORIZED", {
        message: "Invalid personal access token",
      })
    }

    await options.markPatUsedAt(pat.id, new Date())

    return {
      userId: pat.userId,
      patId: pat.id,
      tokenPrefix,
    }
  }
}
