import { app } from "electron"
import { serve, type ServerType } from "@hono/node-server"
import { app as agentApp } from "simple-agents/app"
import path from "node:path"
import fs from "node:fs"

const AGENT_PORT = 3005

let server: ServerType | null = null

export function getAgentServerUrl(): string {
  return `http://localhost:${AGENT_PORT}`
}

export async function startAgentServer(): Promise<void> {
  if (server) {
    console.log("[AgentServer] Already running")
    return
  }

  // 使用 Electron userData 目录作为数据目录
  const userDataDir = app.getPath("userData")
  const dataDir = path.join(userDataDir, "agent-data")

  // 确保数据目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  // 覆盖 DATA_DIR（simple-agents 使用 process.env.DATA_DIR）
  process.env.DATA_DIR = dataDir

  // 重新初始化数据库和技能目录（在 Electron 环境中需要确保目录已创建）
  // 注意：simple-agents 的 db/index.ts 在模块加载时已执行初始化
  // 这里确保目录结构存在

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
