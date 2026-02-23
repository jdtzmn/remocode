import { describe, expect, it } from "vitest"

import { createApp } from "./app"

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

    expect(response.status).toBe(404)
  })
})
