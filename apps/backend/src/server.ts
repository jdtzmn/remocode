import { serve } from "@hono/node-server"

import { createApp } from "./app"
import { loadEnv } from "./config/env"

const env = loadEnv()
const app = createApp()

serve({
  fetch: app.fetch,
  port: env.PORT,
})
