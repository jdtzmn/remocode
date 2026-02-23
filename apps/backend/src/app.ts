import { Hono } from "hono"

export function createApp() {
  const app = new Hono()

  app.get("/health", (context) => {
    return context.json({ ok: true })
  })

  return app
}
