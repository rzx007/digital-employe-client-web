import "dotenv/config"
import { createDeepAgent, FilesystemBackend } from "deepagents"
import { ChatOpenAI } from "@langchain/openai"
import path from "node:path"

const WORK_DIR = process.env.WORK_DIR || path.join(process.cwd(), "workspace")

const model = new ChatOpenAI({
  model: "glm-4.7",
  openAIApiKey: process.env.GLM_API_KEY,
  configuration: {
    baseURL: process.env.GLM_BASE_URL,
  },
  temperature: 0,
})

const systemPrompt = `你是一个专业的文件管理助手。你可以读取、创建和编辑文件，也可以使用 ls、glob、grep 等工具浏览和搜索文件。

当用户提出涉及文件操作的需求时，请使用你可用的工具来完成。

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

const agent = createDeepAgent({
  model,
  systemPrompt,
  backend: new FilesystemBackend({ rootDir: WORK_DIR, virtualMode: true }),
})

export { agent, WORK_DIR }
