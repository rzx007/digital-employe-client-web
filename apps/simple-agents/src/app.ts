import { Hono } from "hono"
import { cors } from "hono/cors"
import { readFileSync, existsSync, statSync } from "node:fs"
import { join } from "node:path"
import sessionRoutes from "./routes/sessions"
import employeeRoutes from "./routes/employees"
import chatRoutes from "./routes/chat"
import artifactRoutes from "./routes/artifacts"
import groupRoutes from "./routes/groups"
import cronRoutes from "./routes/cron"
import {
  getDataDir,
  getStaticDir,
  initDb,
  setStaticDir,
  setRootDir,
} from "./db"
import openApiDoc from "./doc/openapi.json"
import { ensureSkillDirs } from "./services/skill-service"
import mockManagementRoutes from "./routes/mock-management"
import { unifiedResponse, SKIP_RESPONSE_WRAP } from "./middleware/response"
import { CronScheduler } from "./cron"

const app = new Hono()

app.use("/*", cors())

app.use("/*", unifiedResponse)

app.use(async (c, next) => {
  if (c.req.path.startsWith("/static/")) {
    const filePath = c.req.path.replace("/static/", "")
    const fullPath = join(getStaticDir(), filePath)

    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return c.text("Not Found", 404)
    }

    const ext = fullPath.split(".").pop() || ""
    const mimeTypes: Record<string, string> = {
      html: "text/html",
      js: "text/javascript",
      css: "text/css",
      json: "application/json",
      png: "image/png",
      jpg: "image/jpeg",
      svg: "image/svg+xml",
    }

    c.header("Content-Type", mimeTypes[ext] || "text/plain")
    return c.body(readFileSync(fullPath))
  }
  await next()
})

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

export function setup(
  dataDir?: string,
  migrationsDir?: string,
  staticDir?: string,
  rootDir?: string
) {
  if (initialized) return app
  initialized = true

  if (rootDir) {
    setRootDir(rootDir)
  }
  if (staticDir) {
    setStaticDir(staticDir)
  }
  if (dataDir) {
    process.env.DATA_DIR = dataDir
  }

  initDb(dataDir, migrationsDir)
  ensureSkillDirs()

  return app
}

export const cronScheduler = new CronScheduler({
  timezone: "Asia/Shanghai",
  onTick: (taskId) => {
    console.log(`[Cron] Task triggered: ${taskId}`)
  },
})

export { app, getDataDir as DATA_DIR, SKIP_RESPONSE_WRAP }
