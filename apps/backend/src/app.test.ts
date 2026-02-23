import { ApiErrorSchema } from "@remocode/contracts"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { createApp } from "./app"
import { ApiHttpError } from "./http/errors"

describe("createApp", () => {
  it("returns ok for health endpoint", async () => {
    const app = createApp()
    const response = await app.request("/health")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it("returns not found for unknown routes", async () => {
    const app = createApp()
    const response = await app.request("/does-not-exist")
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body).toEqual({
      error: {
        code: "REQUEST_NOT_FOUND",
        message: "Route not found",
        details: {},
      },
    })
    expect(ApiErrorSchema.safeParse(body).success).toBe(true)
  })

  it("maps known API errors to canonical response", async () => {
    const app = createApp()

    app.get("/forbidden", () => {
      throw new ApiHttpError("FORBIDDEN", {
        message: "Access denied by policy",
        details: { policy: "workspace-readonly" },
      })
    })

    const response = await app.request("/forbidden")
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Access denied by policy",
        details: {
          policy: "workspace-readonly",
        },
      },
    })
    expect(ApiErrorSchema.safeParse(body).success).toBe(true)
  })

  it("maps unknown errors to INTERNAL_ERROR", async () => {
    const app = createApp()

    app.get("/explode", () => {
      throw new Error("boom")
    })

    const response = await app.request("/explode")
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        details: {},
      },
    })
    expect(ApiErrorSchema.safeParse(body).success).toBe(true)
  })

  it("maps zod validation errors to INVALID_PAYLOAD", async () => {
    const app = createApp()
    const querySchema = z.object({ count: z.coerce.number().int().min(1) })

    app.get("/validate", (context) => {
      querySchema.parse(context.req.query())
      return context.json({ ok: true })
    })

    const response = await app.request("/validate?count=0")
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      error: {
        code: "INVALID_PAYLOAD",
        message: "Invalid payload",
        details: {
          issues: [
            {
              path: "count",
            },
          ],
        },
      },
    })
    expect(ApiErrorSchema.safeParse(body).success).toBe(true)
  })
})
