import { randomBytes } from "node:crypto"

import {
  PatCreateRequestSchema,
  type PatCreateResponse,
  type PatListItem,
  type PatListResponse,
} from "@remocode/contracts"

import { hashPatSecret } from "../auth/pat"
import { ApiHttpError } from "../http/errors"

export type PatRow = {
  id: string
  userId: string
  label: string
  tokenPrefix: string
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

export type PatsStore = {
  createPat: (args: {
    userId: string
    label: string
    tokenPrefix: string
    secretHash: string
    createdAt: Date
  }) => Promise<PatRow>
  listPats: (args: { userId: string }) => Promise<PatRow[]>
  revokePat: (args: { patId: string; userId: string; revokedAt: Date }) => Promise<PatRow | null>
}

export type PatCreateService = (args: {
  userId: string
  payload: unknown
}) => Promise<PatCreateResponse>

export type PatListService = (args: { userId: string }) => Promise<PatListResponse>

export type PatRevokeService = (args: {
  userId: string
  patId: string
}) => Promise<{ ok: true }>

function generatePatToken(): { tokenPrefix: string; secret: string; token: string } {
  const prefix = randomBytes(8).toString("hex")
  const secret = randomBytes(32).toString("hex")
  const token = `pat_${prefix}_${secret}`
  return { tokenPrefix: prefix, secret, token }
}

export function createPatCreateService(store: PatsStore, pepper: string): PatCreateService {
  return async ({ userId, payload }) => {
    const parsed = PatCreateRequestSchema.parse(payload)
    const { tokenPrefix, secret, token } = generatePatToken()
    const secretHash = hashPatSecret(secret, pepper)
    const createdAt = new Date()

    const row = await store.createPat({
      userId,
      label: parsed.label,
      tokenPrefix,
      secretHash,
      createdAt,
    })

    return {
      id: row.id,
      label: row.label,
      token,
      created_at: row.createdAt.toISOString(),
    }
  }
}

export function createPatListService(store: PatsStore): PatListService {
  return async ({ userId }) => {
    const rows = await store.listPats({ userId })

    const pats: PatListItem[] = rows.map((row) => ({
      id: row.id,
      label: row.label,
      token_prefix: row.tokenPrefix,
      created_at: row.createdAt.toISOString(),
      last_used_at: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
    }))

    return { pats }
  }
}

export function createPatRevokeService(store: PatsStore): PatRevokeService {
  return async ({ userId, patId }) => {
    const row = await store.revokePat({ patId, userId, revokedAt: new Date() })

    if (!row) {
      throw new ApiHttpError("REQUEST_NOT_FOUND", {
        message: "PAT not found",
      })
    }

    return { ok: true }
  }
}
