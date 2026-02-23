import { z } from "zod"

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1).optional(),
  SUPABASE_ISSUER: z.string().url().optional(),
  SUPABASE_AUDIENCE: z.string().min(1).optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  PAT_HASH_PEPPER: z.string().min(1).optional(),
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  SOCKET_IO_CORS_ORIGIN: z.string().min(1).optional(),
})

function formatZodIssues(issues: z.ZodIssue[]) {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "env"
    return `${path}: ${issue.message}`
  })
}

export function loadEnv(raw: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(raw)

  if (!result.success) {
    const details = formatZodIssues(result.error.issues).join("; ")
    throw new Error(`Invalid environment configuration: ${details}`)
  }

  return result.data
}

export type AppEnv = z.infer<typeof envSchema>
