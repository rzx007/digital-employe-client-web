import "dotenv/config"
import { createDeepAgent, FilesystemBackend } from "deepagents"
import { ChatOpenAI } from "@langchain/openai"
import path from "node:path"
import fs from "node:fs"
import { DATA_DIR } from "./db"

const model = new ChatOpenAI({
  model: "glm-4.7",
  openAIApiKey: process.env.OPENAI_API_KEY || process.env.GLM_API_KEY,
  configuration: {
    baseURL: process.env.GLM_BASE_URL,
  },
  temperature: 0,
})

const systemPrompt = `你是一个专业的 AI 助手。你可以读取、创建和编辑文件，也可以使用 ls、glob、grep 等工具浏览和搜索文件。

可用工具说明：
- ls: 列出目录内容
- read_file: 读取文件内容
- write_file: 创建或覆盖文件
- edit_file: 编辑文件（精确字符串替换）
- glob: 按模式查找文件
- grep: 搜索文件内容
- task: 将复杂任务委派给子代理执行
- write_todos: 管理任务列表

请始终用中文回复用户。`

function getSessionDir(threadId: string): string {
  const sessionDir = path.join(DATA_DIR, "workspace", threadId)
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
  }
  return sessionDir
}

const agent = createDeepAgent({
  model,
  systemPrompt,
  backend: (runtime: any) => {
    const threadId = runtime.configurable?.thread_id || "default"
    const dir = getSessionDir(threadId)
    return new FilesystemBackend({ rootDir: dir, virtualMode: true })
  },
})

export { agent, getSessionDir }
