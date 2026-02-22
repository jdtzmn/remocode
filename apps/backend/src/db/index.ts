import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"

import { schema } from "./schema"

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error("DATABASE_URL is required")
}

export const sql = postgres(connectionString)
export const db = drizzle(sql, { schema })
