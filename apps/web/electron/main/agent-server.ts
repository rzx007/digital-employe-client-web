import { app } from "electron"
import { serve, type ServerType } from "@hono/node-server"
import { setup } from "simple-agents/app"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const AGENT_PORT = Number(process.env.PORT) || 3005

const isDev = !app.isPackaged
const resourcesBaseDir = isDev
  ? path.join(__dirname, "../../../simple-agents")
  : path.join(process.resourcesPath, "simple-agents")

const MIGRATIONS_DIR = path.join(resourcesBaseDir, "migrations")
const STATIC_DIR = path.join(resourcesBaseDir, "static")
const ROOT_DIR = resourcesBaseDir

let server: ServerType | null = null

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  const content = fs.readFileSync(filePath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (key && value) {
      process.env[key] = value
    }
  }
}

export function getAgentServerUrl(): string {
  return `http://localhost:${AGENT_PORT}`
}

export async function startAgentServer(): Promise<void> {
  if (server) {
    console.log("[AgentServer] Already running")
    return
  }

  if (app.isPackaged) {
    const envPath = path.join(process.resourcesPath, ".env")
    loadEnvFile(envPath)
    console.log("[AgentServer] Loaded .env from:", envPath)
  }

  const userDataDir = app.getPath("userData")
  console.log("[AgentServer] User data directory:", userDataDir)
  const dataDir = path.join(userDataDir, "agent-data")

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const agentApp = setup({
    dataDir,
    migrationsDir: MIGRATIONS_DIR,
    staticDir: STATIC_DIR,
    rootDir: ROOT_DIR,
  })

  console.log(`[AgentServer] Starting on port ${AGENT_PORT}`)
  console.log(`[AgentServer] Data directory: ${dataDir}`)
  console.log(`[AgentServer] Migrations: ${MIGRATIONS_DIR}`)
  console.log(`[AgentServer] Static: ${STATIC_DIR}`)

  server = serve({ fetch: agentApp.fetch, port: AGENT_PORT })

  console.log(`[AgentServer] URL: ${getAgentServerUrl()}`)

  console.log("[AgentServer] Started successfully")
}

export function stopAgentServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve()
      return
    }

    console.log("[AgentServer] Stopping...")
    server.close(() => {
      server = null
      console.log("[AgentServer] Stopped")
      resolve()
    })
  })
}
