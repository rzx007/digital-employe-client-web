import { Hono } from "hono"
import { cors } from "hono/cors"
import { serveStatic } from "@hono/node-server/serve-static"
import sessionRoutes from "./routes/sessions"
import employeeRoutes from "./routes/employees"
import chatRoutes from "./routes/chat"
import artifactRoutes from "./routes/artifacts"
import groupRoutes from "./routes/groups"
import cronRoutes from "./routes/cron"
import { initDb } from "./db"
import { configureDirs, getDataDir, getStaticDir, type SetupOptions } from "./config"
import openApiDoc from "./doc/openapi.json"
import { ensureSkillDirs } from "./services/skill-service"
import mockManagementRoutes from "./routes/mock-management"
import { unifiedResponse, SKIP_RESPONSE_WRAP } from "./middleware/response"
import { CronScheduler } from "./cron"

const app = new Hono()

app.use("/*", cors())

app.use("/*", unifiedResponse)

app.get("/", (c) => {
  c.set(SKIP_RESPONSE_WRAP, true)
  return c.json({
    name: "simple-agents",
    version: "2.0.0",
    dataDir: getDataDir(),
    endpoints: {
      employees: "RESTful /api/employees",
      sessions: "RESTful /api/sessions",
      chat: "POST /api/sessions/:id/chat",
      chatStream: "POST /api/sessions/:id/chat/stream",
      messages: "GET /api/sessions/:id/messages",
      artifacts: "GET /api/sessions/:id/artifacts",
      cron: "RESTful /api/cron",
    },
  })
})

app.get("/doc", (c) => {
  c.set(SKIP_RESPONSE_WRAP, true)
  return c.json(openApiDoc)
})

app.route("/api/employees", employeeRoutes)
app.route("/api/sessions", sessionRoutes)
app.route("/api/sessions", chatRoutes)
app.route("/api/sessions", artifactRoutes)
app.route("/api/groups", groupRoutes)
app.route("/api/cron", cronRoutes)
app.route("/management", mockManagementRoutes)

let initialized = false

export function setup(options?: SetupOptions) {
  if (initialized) return app
  initialized = true

  configureDirs(options ?? {})

  app.use("/public/*", serveStatic({
    root: getStaticDir(),
    rewriteRequestPath: (path) => path.replace(/^\/public/, ""),
  }))

  initDb()
  ensureSkillDirs()

  return app
}

export const cronScheduler = new CronScheduler({
  timezone: "Asia/Shanghai",
  onTick: (taskId) => {
    console.log(`[Cron] Task triggered: ${taskId}`)
  },
})

export { app, SKIP_RESPONSE_WRAP }
