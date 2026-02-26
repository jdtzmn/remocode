import { serve } from "@hono/node-server"

import { createApp } from "./app"
import { createRuntimeAuthMiddlewares } from "./auth/runtime"
import { loadEnv } from "./config/env"
import { runtimePluginActivityService } from "./plugin-activity/runtime"
import { runtimePluginEventsIngestService } from "./plugin-events/runtime"
import { runtimePluginHeartbeatService } from "./plugin-heartbeat/runtime"

const env = loadEnv()
const auth = createRuntimeAuthMiddlewares(env)
const app = createApp({
  ...auth,
  pluginHeartbeat: runtimePluginHeartbeatService,
  pluginActivity: runtimePluginActivityService,
  pluginEventsIngest: runtimePluginEventsIngestService,
})

serve({
  fetch: app.fetch,
  port: env.PORT,
})
