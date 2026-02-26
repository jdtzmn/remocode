import { serve } from "@hono/node-server"

import { createApp } from "./app"
import {
  createRuntimeAuthMiddlewares,
  createRuntimePatAuthenticator,
  createRuntimeSupabaseJwtVerifier,
} from "./auth/runtime"
import { loadEnv, requireAuthEnv } from "./config/env"
import { runtimePluginActivityService } from "./plugin-activity/runtime"
import { createRuntimePluginEventsIngestService } from "./plugin-events/runtime"
import { runtimePluginHeartbeatService } from "./plugin-heartbeat/runtime"
import { createRuntimeRequestRespondService } from "./requests/respond-runtime"
import { runtimeRequestsOpenService } from "./requests/runtime"
import { runtimeStaleEvaluatorJob } from "./session-projections/stale-evaluator-runtime"
import { runtimeSessionsOpenService } from "./sessions/runtime"
import { attachSocketServer, createSocketServer } from "./socket"
import { createRuntimeSocketDeltaEmitter } from "./socket/emitter-runtime"

const env = loadEnv()
const authEnv = requireAuthEnv(env)
const auth = createRuntimeAuthMiddlewares(env)

const io = createSocketServer({
  verifyToken: createRuntimeSupabaseJwtVerifier(authEnv),
  authenticate: createRuntimePatAuthenticator(authEnv),
  corsOrigin: env.SOCKET_IO_CORS_ORIGIN,
})

const socketEmitter = createRuntimeSocketDeltaEmitter(io, {
  sessionsOpen: runtimeSessionsOpenService,
  requestsOpen: runtimeRequestsOpenService,
})

const app = createApp({
  ...auth,
  pluginHeartbeat: runtimePluginHeartbeatService,
  pluginActivity: runtimePluginActivityService,
  pluginEventsIngest: createRuntimePluginEventsIngestService(socketEmitter),
  sessionsOpen: runtimeSessionsOpenService,
  requestsOpen: runtimeRequestsOpenService,
  requestsRespond: createRuntimeRequestRespondService(io),
})

const httpServer = serve({
  fetch: app.fetch,
  port: env.PORT,
})

attachSocketServer(io, httpServer)

// Start background job: mark stale sessions (60s threshold, runs every 30s)
runtimeStaleEvaluatorJob.start()
