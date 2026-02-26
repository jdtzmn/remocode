import { describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"

import { ApiHttpError } from "../http/errors"
import {
  type PatRow,
  type PatsStore,
  createPatCreateService,
  createPatListService,
  createPatRevokeService,
} from "./service"

const TEST_PEPPER = "test-pepper"

function makePatRow(overrides: Partial<PatRow> = {}): PatRow {
  return {
    id: "pat-1",
    userId: "user-1",
    label: "work-mac",
    tokenPrefix: "abcdef1234567890",
    createdAt: new Date("2026-02-22T10:00:00.000Z"),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

function makeStore(overrides: Partial<PatsStore> = {}): PatsStore {
  return {
    createPat: vi.fn(async () => makePatRow()),
    listPats: vi.fn(async () => []),
    revokePat: vi.fn(async () => makePatRow()),
    ...overrides,
  }
}

describe("createPatCreateService", () => {
  it("validates payload and creates a PAT returning plaintext token once", async () => {
    const store = makeStore()
    const service = createPatCreateService(store, TEST_PEPPER)

    const result = await service({ userId: "user-1", payload: { label: "work-mac" } })

    expect(result.id).toBe("pat-1")
    expect(result.label).toBe("work-mac")
    expect(result.created_at).toBe("2026-02-22T10:00:00.000Z")
    // Token should match pat_<prefix>_<secret> format
    expect(result.token).toMatch(/^pat_[a-f0-9]+_[a-f0-9]+$/)
  })

  it("calls store.createPat with hashed secret (not plaintext)", async () => {
    const store = makeStore()
    const service = createPatCreateService(store, TEST_PEPPER)

    const result = await service({ userId: "user-1", payload: { label: "my-token" } })

    expect(store.createPat).toHaveBeenCalledTimes(1)
    const call = (store.createPat as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      userId: string
      label: string
      tokenPrefix: string
      secretHash: string
      createdAt: Date
    }

    expect(call.userId).toBe("user-1")
    expect(call.label).toBe("my-token")
    expect(call.secretHash).toMatch(/^sha256:/)
    // The secret hash should NOT be the plaintext token
    expect(call.secretHash).not.toContain(result.token)
    expect(call.createdAt).toBeInstanceOf(Date)
  })

  it("generates a unique token prefix per call", async () => {
    const store = makeStore({
      createPat: vi.fn(async ({ tokenPrefix }) => makePatRow({ tokenPrefix })),
    })
    const service = createPatCreateService(store, TEST_PEPPER)

    const result1 = await service({ userId: "user-1", payload: { label: "t1" } })
    const result2 = await service({ userId: "user-1", payload: { label: "t2" } })

    expect(result1.token).not.toBe(result2.token)
  })

  it("rejects invalid payload (missing label)", async () => {
    const store = makeStore()
    const service = createPatCreateService(store, TEST_PEPPER)

    await expect(service({ userId: "user-1", payload: {} })).rejects.toBeInstanceOf(ZodError)
    expect(store.createPat).not.toHaveBeenCalled()
  })

  it("rejects empty label", async () => {
    const store = makeStore()
    const service = createPatCreateService(store, TEST_PEPPER)

    await expect(service({ userId: "user-1", payload: { label: "" } })).rejects.toBeInstanceOf(
      ZodError,
    )
  })
})

describe("createPatListService", () => {
  it("returns empty list when no PATs", async () => {
    const store = makeStore({ listPats: vi.fn(async () => []) })
    const service = createPatListService(store)

    const result = await service({ userId: "user-1" })

    expect(result).toEqual({ pats: [] })
    expect(store.listPats).toHaveBeenCalledWith({ userId: "user-1" })
  })

  it("returns PATs with correct shape (no secret, includes token_prefix)", async () => {
    const now = new Date("2026-02-22T10:00:00.000Z")
    const lastUsed = new Date("2026-02-22T12:00:00.000Z")
    const store = makeStore({
      listPats: vi.fn(async () => [
        makePatRow({
          id: "pat-1",
          label: "work-mac",
          tokenPrefix: "prefix123",
          createdAt: now,
          lastUsedAt: lastUsed,
        }),
        makePatRow({
          id: "pat-2",
          label: "laptop",
          tokenPrefix: "prefix456",
          createdAt: now,
          lastUsedAt: null,
        }),
      ]),
    })
    const service = createPatListService(store)

    const result = await service({ userId: "user-1" })

    expect(result.pats).toHaveLength(2)
    expect(result.pats[0]).toEqual({
      id: "pat-1",
      label: "work-mac",
      token_prefix: "prefix123",
      created_at: "2026-02-22T10:00:00.000Z",
      last_used_at: "2026-02-22T12:00:00.000Z",
      revoked_at: null,
    })
    expect(result.pats[1]).toEqual({
      id: "pat-2",
      label: "laptop",
      token_prefix: "prefix456",
      created_at: "2026-02-22T10:00:00.000Z",
      last_used_at: null,
      revoked_at: null,
    })
    // Ensure no secret_hash is exposed
    expect(Object.keys(result.pats[0])).not.toContain("secret_hash")
    expect(Object.keys(result.pats[0])).not.toContain("secretHash")
  })
})

describe("createPatRevokeService", () => {
  it("revokes a PAT and returns ok", async () => {
    const store = makeStore({
      revokePat: vi.fn(async () => makePatRow({ revokedAt: new Date() })),
    })
    const service = createPatRevokeService(store)

    const result = await service({ userId: "user-1", patId: "pat-1" })

    expect(result).toEqual({ ok: true })
    expect(store.revokePat).toHaveBeenCalledTimes(1)
    const call = (store.revokePat as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      patId: string
      userId: string
      revokedAt: Date
    }
    expect(call.patId).toBe("pat-1")
    expect(call.userId).toBe("user-1")
    expect(call.revokedAt).toBeInstanceOf(Date)
  })

  it("throws REQUEST_NOT_FOUND when PAT does not exist or already revoked", async () => {
    const store = makeStore({
      revokePat: vi.fn(async () => null),
    })
    const service = createPatRevokeService(store)

    await expect(service({ userId: "user-1", patId: "nonexistent" })).rejects.toBeInstanceOf(
      ApiHttpError,
    )

    const error = await service({ userId: "user-1", patId: "nonexistent" }).catch((e) => e)
    expect(error.code).toBe("REQUEST_NOT_FOUND")
  })

  it("uses userId from auth context (cannot revoke other user PATs)", async () => {
    const store = makeStore({
      revokePat: vi.fn(async () => null),
    })
    const service = createPatRevokeService(store)

    await expect(service({ userId: "user-2", patId: "pat-1" })).rejects.toBeInstanceOf(ApiHttpError)

    const call = (store.revokePat as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      patId: string
      userId: string
    }
    expect(call.userId).toBe("user-2")
  })
})
