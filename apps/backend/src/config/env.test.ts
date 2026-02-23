import { describe, expect, it } from "vitest"

import { loadEnv } from "./env"

describe("loadEnv", () => {
  it("uses defaults when optional values are missing", () => {
    const env = loadEnv({})

    expect(env.NODE_ENV).toBe("development")
    expect(env.PORT).toBe(3001)
  })

  it("throws on invalid port", () => {
    expect(() => loadEnv({ PORT: "99999" })).toThrow("Invalid environment configuration")
  })

  it("accepts valid explicit values", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      PORT: "8080",
      SUPABASE_ISSUER: "https://example.supabase.co/auth/v1",
      SUPABASE_AUDIENCE: "authenticated",
      SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
      PAT_HASH_PEPPER: "pepper",
      EXPO_ACCESS_TOKEN: "token",
      SOCKET_IO_CORS_ORIGIN: "https://app.example.com",
    })

    expect(env.NODE_ENV).toBe("production")
    expect(env.PORT).toBe(8080)
    expect(env.SUPABASE_AUDIENCE).toBe("authenticated")
  })
})
