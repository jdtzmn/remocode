import { serve } from "@hono/node-server"

import { createApp } from "./app"
import {
  createRuntimeAuthMiddlewares,
  createRuntimePatAuthenticator,
  createRuntimeSupabaseJwtVerifier,
} from "./auth/runtime"
import { loadEnv, requireAuthEnv } from "./config/env"
import { runtimePluginActivityService } from "./plugin-activity/runtime"
import { runtimePluginEventsIngestService } from "./plugin-events/runtime"
import { runtimePluginHeartbeatService } from "./plugin-heartbeat/runtime"
import { runtimeRequestsOpenService } from "./requests/runtime"
import { runtimeSessionsOpenService } from "./sessions/runtime"
import { attachSocketServer, createSocketServer } from "./socket"

const env = loadEnv()
const authEnv = requireAuthEnv(env)
const auth = createRuntimeAuthMiddlewares(env)
const app = createApp({
  ...auth,
  pluginHeartbeat: runtimePluginHeartbeatService,
  pluginActivity: runtimePluginActivityService,
  pluginEventsIngest: runtimePluginEventsIngestService,
  sessionsOpen: runtimeSessionsOpenService,
  requestsOpen: runtimeRequestsOpenService,
})

const io = createSocketServer({
  verifyToken: createRuntimeSupabaseJwtVerifier(authEnv),
  authenticate: createRuntimePatAuthenticator(authEnv),
  corsOrigin: env.SOCKET_IO_CORS_ORIGIN,
})

const httpServer = serve({
  fetch: app.fetch,
  port: env.PORT,
})

attachSocketServer(io, httpServer)
