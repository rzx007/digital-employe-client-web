import { app } from "electron"
import { serve, type ServerType } from "@hono/node-server"
import { setup } from "simple-agents/app"
import path from "node:path"
import fs from "node:fs"

const AGENT_PORT = Number(process.env.PORT) || 3005

let server: ServerType | null = null

export function getAgentServerUrl(): string {
  return `http://localhost:${AGENT_PORT}`
}

export async function startAgentServer(): Promise<void> {
  if (server) {
    console.log("[AgentServer] Already running")
    return
  }

  const userDataDir = app.getPath("userData")
  const dataDir = path.join(userDataDir, "agent-data")

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const agentApp = setup(dataDir)

  console.log(`[AgentServer] Starting on port ${AGENT_PORT}`)
  console.log(`[AgentServer] Data directory: ${dataDir}`)

  server = serve({ fetch: agentApp.fetch, port: AGENT_PORT })

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
