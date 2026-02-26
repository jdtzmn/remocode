import { Hono } from "hono"
import { describe, expect, it } from "vitest"

import type { AuthBindings } from "../auth/types"
import { createInMemoryRateLimitStore, rateLimitMiddleware } from "./rate-limit"

function makeApp(max: number, windowMs = 60_000) {
  const store = createInMemoryRateLimitStore()
  const app = new Hono<AuthBindings>()

  // Inject a fake auth identity so the middleware can derive a key
  app.use("*", async (context, next) => {
    context.set("appAuth", {
      userId: "user-test",
      supabaseUserId: "supabase-test",
      claims: { sub: "supabase-test" },
    })
    await next()
  })

  app.use(
    "*",
    rateLimitMiddleware({
      max,
      windowMs,
      store,
    }),
  )

  app.get("/ping", (c) => c.json({ ok: true }))

  return app
}

describe("rateLimitMiddleware", () => {
  it("allows requests under the limit", async () => {
    const app = makeApp(3)

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/ping")
      expect(res.status).toBe(200)
    }
  })

  it("returns 429 when the limit is exceeded", async () => {
    const app = makeApp(2)

    await app.request("/ping")
    await app.request("/ping")

    const res = await app.request("/ping")
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body).toMatchObject({
      error: {
        code: "RATE_LIMITED",
      },
    })
  })

  it("sets X-RateLimit-Limit header", async () => {
    const app = makeApp(5)
    const res = await app.request("/ping")
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5")
  })

  it("sets X-RateLimit-Remaining header and decrements it", async () => {
    const app = makeApp(3)

    const res1 = await app.request("/ping")
    expect(res1.headers.get("X-RateLimit-Remaining")).toBe("2")

    const res2 = await app.request("/ping")
    expect(res2.headers.get("X-RateLimit-Remaining")).toBe("1")
  })

  it("sets Retry-After header on rate-limited response", async () => {
    const app = makeApp(1, 30_000)

    await app.request("/ping")
    const res = await app.request("/ping")

    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBe("30")
  })

  it("passes through when no auth identity is available", async () => {
    const store = createInMemoryRateLimitStore()
    const app = new Hono<AuthBindings>()

    // No auth middleware — identity is undefined
    app.use("*", rateLimitMiddleware({ max: 1, windowMs: 60_000, store }))
    app.get("/ping", (c) => c.json({ ok: true }))

    // Should pass through even after exceeding limit because key is undefined
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/ping")
      expect(res.status).toBe(200)
    }
  })

  it("supports a custom keyFn", async () => {
    const store = createInMemoryRateLimitStore()
    const app = new Hono<AuthBindings>()

    // Use IP address as key
    app.use(
      "*",
      rateLimitMiddleware({
        max: 2,
        windowMs: 60_000,
        store,
        keyFn: (c) => c.req.header("x-forwarded-for") ?? undefined,
      }),
    )
    app.get("/ping", (c) => c.json({ ok: true }))

    const headers = { "x-forwarded-for": "1.2.3.4" }

    await app.request("/ping", { headers })
    await app.request("/ping", { headers })
    const res = await app.request("/ping", { headers })

    expect(res.status).toBe(429)
  })

  it("counts separate keys independently", async () => {
    const store = createInMemoryRateLimitStore()

    function makeAppForUser(userId: string) {
      const app = new Hono<AuthBindings>()
      app.use("*", async (context, next) => {
        context.set("appAuth", {
          userId,
          supabaseUserId: `supabase-${userId}`,
          claims: { sub: `supabase-${userId}` },
        })
        await next()
      })
      app.use("*", rateLimitMiddleware({ max: 2, windowMs: 60_000, store }))
      app.get("/ping", (c) => c.json({ ok: true }))
      return app
    }

    const appA = makeAppForUser("user-A")
    const appB = makeAppForUser("user-B")

    // User A uses up their limit
    await appA.request("/ping")
    await appA.request("/ping")
    const resA3 = await appA.request("/ping")
    expect(resA3.status).toBe(429)

    // User B is unaffected
    const resB1 = await appB.request("/ping")
    expect(resB1.status).toBe(200)
  })

  it("evicts stale timestamps after window expires", async () => {
    const store = createInMemoryRateLimitStore()
    const windowMs = 100 // 100ms window for fast test

    const app = new Hono<AuthBindings>()
    app.use("*", async (context, next) => {
      context.set("appAuth", {
        userId: "user-evict",
        supabaseUserId: "supabase-evict",
        claims: { sub: "supabase-evict" },
      })
      await next()
    })
    app.use("*", rateLimitMiddleware({ max: 2, windowMs, store }))
    app.get("/ping", (c) => c.json({ ok: true }))

    // Fill the window
    await app.request("/ping")
    await app.request("/ping")

    // At limit - next should fail
    const resFail = await app.request("/ping")
    expect(resFail.status).toBe(429)

    // Wait for the window to expire
    await new Promise((resolve) => setTimeout(resolve, windowMs + 10))

    // Now the window is fresh - should succeed again
    const resOk = await app.request("/ping")
    expect(resOk.status).toBe(200)
  })
})
