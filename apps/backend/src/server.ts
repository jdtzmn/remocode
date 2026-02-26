import { serve } from "@hono/node-server"

import { createAlertEngine } from "./alerts"
import { createApp } from "./app"
import {
  createRuntimeAuthMiddlewares,
  createRuntimePatAuthenticator,
  createRuntimeSupabaseJwtVerifier,
} from "./auth/runtime"
import { loadEnv, requireAuthEnv } from "./config/env"
import { logger } from "./logger"
import { globalMetrics } from "./metrics"
import {
  createRuntimePatCreateService,
  runtimePatListService,
  runtimePatRevokeService,
} from "./pats/runtime"
import { runtimePluginActivityService } from "./plugin-activity/runtime"
import { createRuntimePluginEventsIngestService } from "./plugin-events/runtime"
import { runtimePluginHeartbeatService } from "./plugin-heartbeat/runtime"
import {
  runtimePushTokenDeleteService,
  runtimePushTokenRegisterService,
} from "./push-tokens/runtime"
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
  requestsRespond: createRuntimeRequestRespondService(io, socketEmitter),
  patCreate: createRuntimePatCreateService(authEnv.PAT_HASH_PEPPER),
  patList: runtimePatListService,
  patRevoke: runtimePatRevokeService,
  pushTokenRegister: runtimePushTokenRegisterService,
  pushTokenDelete: runtimePushTokenDeleteService,
})

const httpServer = serve({
  fetch: app.fetch,
  port: env.PORT,
})

attachSocketServer(io, httpServer)

// Start background job: mark stale sessions (60s threshold, runs every 30s)
runtimeStaleEvaluatorJob.start()

// Start alert engine (polls metrics every 30s, logs on state transitions)
const alertEngine = createAlertEngine({
  metrics: globalMetrics,
  onAlert: (event) => {
    const logFn = event.state === "firing" ? logger.error : logger.info
    logFn(`alert:${event.state}`, {
      alert_name: event.name,
      alert_state: event.state,
      alert_message: event.message,
      fired_at: event.firedAt,
      ...event.details,
    })
  },
})
alertEngine.start()
