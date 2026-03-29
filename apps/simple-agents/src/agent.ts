/**
 * Agent 模块 - DeepAgents 代理工厂与缓存
 *
 * 本模块负责：
 * 1. 初始化 AI 模型 (GLM-4.7)
 * 2. 定义默认系统提示词
 * 3. 按员工 ID 缓存 Agent 实例（Agent 工厂模式）
 * 4. 管理会话目录（按会话隔离文件系统）
 * 5. 提供缓存失效机制
 *
 * 核心架构变化：
 * - 从单例 agent → 按 employeeId 缓存的 Agent 工厂
 * - 每个员工有专属的 systemPrompt 和 skills
 * - 员工配置变更时通过 invalidateAgentCache() 清除缓存
 * - 创建新会话时通过 skill-service 同步技能文件
 *
 * 技能加载流程：
 * 1. 创建会话时，skill-service 将全局+员工技能复制到会话目录
 * 2. Agent 配置 skills: ["/skills/", "/employee-skills/"]
 * 3. SkillsMiddleware 在运行时通过 backend 读取会话目录中的技能文件
 */

import "dotenv/config"
import { createDeepAgent, FilesystemBackend } from "deepagents"
import { ChatOpenAI } from "@langchain/openai"
import path from "node:path"
import fs from "node:fs"
import { DATA_DIR } from "./db"

/**
 * AI 模型配置
 *
 * 使用 GLM-4.7 模型，通过 OpenAI 兼容 API 调用
 * - temperature=0 保证输出稳定（不随机）
 * - 支持通过环境变量配置 API 密钥和基础 URL
 */
const model = new ChatOpenAI({
  model: "glm-4.7",
  openAIApiKey: process.env.OPENAI_API_KEY || process.env.GLM_API_KEY,
  configuration: {
    baseURL: process.env.GLM_BASE_URL,
  },
  temperature: 0,
})

/**
 * 默认系统提示词 - 当员工未设置 systemPrompt 时使用
 *
 * 这段提示词告诉代理：
 * - 它是一个专业 AI 助手
 * - 它可以执行文件操作和搜索
 * - 可以使用哪些工具
 * - 使用中文回复
 */
const DEFAULT_SYSTEM_PROMPT = `你是一个专业的 AI 助手。你可以读取、创建和编辑文件，也可以使用 ls、glob、grep 等工具浏览和搜索文件。

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

// ============ Agent 缓存 ============

/**
 * Agent 实例缓存
 *
 * key: employeeId
 * value: createDeepAgent 创建的代理实例
 *
 * 使用 Map 缓存避免重复创建（createDeepAgent 开销较大）
 * 员工配置变更时通过 invalidateAgentCache() 清除对应缓存
 */
const agentCache = new Map<string, any>()

/**
 * 获取指定员工的 Agent 实例
 *
 * 缓存策略：
 * - 命中缓存 → 直接返回
 * - 未命中 → 创建新实例并缓存
 *
 * @param employeeId 员工 ID（用于缓存 key）
 * @param systemPrompt 员工专属系统提示词（可选，默认使用 DEFAULT_SYSTEM_PROMPT）
 * @returns DeepAgent 实例
 */
export function getAgent(employeeId: string, systemPrompt?: string): any {
  if (agentCache.has(employeeId)) return agentCache.get(employeeId)

  const prompt = systemPrompt || DEFAULT_SYSTEM_PROMPT

  const agent = createDeepAgent({
    model,
    systemPrompt: prompt,
    // 技能路径相对于 backend 的 rootDir（即会话目录）
    // 全局技能在 skills/ 下，员工专属技能在 employee-skills/ 下
    skills: ["/skills/", "/employee-skills/"],
    backend: (runtime: any) => {
      const threadId = runtime.configurable?.thread_id || "default"
      const dir = getSessionDir(threadId)
      return new FilesystemBackend({ rootDir: dir, virtualMode: true })
    },
  })

  agentCache.set(employeeId, agent)
  return agent
}

/**
 * 使 Agent 缓存失效
 *
 * 场景：
 * - 员工更新了 systemPrompt（需要用新提示词重建 Agent）
 * - 员工被删除（清除无用缓存）
 *
 * @param employeeId 指定员工 ID（不传则清除全部缓存）
 */
export function invalidateAgentCache(employeeId?: string): void {
  if (employeeId) {
    agentCache.delete(employeeId)
  } else {
    agentCache.clear()
  }
}

// ============ 会话目录管理 ============

/**
 * 获取会话目录路径
 *
 * @param threadId 会话唯一标识符
 * @returns 会话对应的目录路径
 *
 * 功能：
 * - 根据会话 ID 创建独立的工作目录
 * - 如果目录不存在，自动创建
 * - 会话目录结构：data/workspace/{threadId}/
 *   ├── skills/              ← 全局技能（创建会话时同步）
 *   ├── employee-skills/     ← 员工专属技能（创建会话时同步）
 *   └── (agent 生成的文件)
 */
export function getSessionDir(threadId: string): string {
  const sessionDir = path.join(DATA_DIR, "workspace", threadId)
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
  }
  return sessionDir
}
