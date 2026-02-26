import { serve } from "@hono/node-server"

import { createApp } from "./app"
import { createRuntimeAuthMiddlewares } from "./auth/runtime"
import { loadEnv } from "./config/env"
import { runtimePluginEventsIngestService } from "./plugin-events/runtime"

const env = loadEnv()
const auth = createRuntimeAuthMiddlewares(env)
const app = createApp({
  ...auth,
  pluginEventsIngest: runtimePluginEventsIngestService,
})

serve({
  fetch: app.fetch,
  port: env.PORT,
})
