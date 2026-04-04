/**
 * Agent Stream SDK Service - AI SDK 流后台执行引擎
 *
 * 核心职责：
 * 1. 将 agent.stream() 的执行与 SSE 连接解耦（后台运行）
 * 2. 缓冲 UIMessageChunk，支持断线重连时的回放
 * 3. 管理流任务的生命周期（启动、完成、失败、取消）
 * 4. SSE 断开只取消订阅，不取消 agent（agent 继续运行到结束）
 * 5. 完成后自动持久化 assistant 消息到数据库
 * 6. 检测文件产物（artifact）并注入 data-artifact chunk
 *
 * 架构设计：
 *
 * 与 agent-stream-raw.ts 的区别：
 * - raw-stream 广播自定义 StreamEvent（on_chat_model_stream, on_tool_start 等）
 * - sdk-stream 广播 AI SDK 标准 UIMessageChunk（text-delta, tool-input-available 等）
 * - 前端 useChat 直接消费 UIMessageChunk，无需转换
 *
 * 数据流：
 *
 * [首次发送] POST /chat/stream
 *   → startSdkStream() 注册内存任务
 *   → setTimeout 后台启动 runInBackground()
 *     → agent.stream() → toUIMessageStream() 迭代
 *       → 每个 chunk 缓冲到 task.chunks + 广播给所有 SSE 订阅者
 *       → 检测文件工具调用 → 读取文件 → 注入 data-artifact chunk
 *     → agent 结束 → 持久化完整消息 → 标记 completed → 广播 finish chunk
 *   → SSE 循环：订阅实时 chunks → writeSSE → 断开只取消订阅
 *
 * [断线重连] GET /chat/stream
 *   → resumeSdkStream() 查注册表
 *     → 活跃：回放 task.chunks + 订阅后续实时 chunks → SSE
 *     → 已结束/不存在：返回 204，前端用 DB 历史消息
 *
 * [手动停止] POST /chat/stream/stop
 *   → cancelSdkStream() → abortController.abort()
 *     → agent 收到 signal 停止生成
 *     → 持久化已有部分内容 → 广播 abort chunk
 */

import type { UIMessageChunk, UIMessage } from "ai"
import { getAgent, getSessionDir } from "../agent"
import { createMessage } from "./message-service"
import { updateSession } from "./session-service"
import { detectNewArtifacts } from "./agent-service"
import { getEmployee } from "./employee-service"
import { applySkillHint } from "./agent-service"
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain"
import * as fs from "node:fs"
import * as path from "node:path"
import { nanoid } from "nanoid"

// ============ 类型定义 ============

/**
 * 事件订阅者函数签名
 *
 * 每个 SSE 连接是一个订阅者，收到 chunk 后写入 SSE 响应
 */
type Subscriber = (chunk: UIMessageChunk) => void

/**
 * SDK 流任务结构
 *
 * 代表一个后台运行的 AI SDK 流式任务，与 SSE 连接解耦
 */
type SdkStreamTask = {
  id: string // 任务唯一标识符（nanoid）
  sessionId: string // 关联的会话 ID
  status: "streaming" | "completed" | "failed" | "cancelled" // 任务状态
  content: string // 累积的文本内容（用于持久化）
  errorMessage: string | null // 错误信息（仅 failed 状态）
  messageId: number | null // 持久化后的消息 ID（completed/cancelled 状态）
  chunks: UIMessageChunk[] // chunk 缓冲区（用于断线重连回放）
  subscribers: Set<Subscriber> // SSE 订阅者集合
  abortController: AbortController // 用于手动取消 agent
  completed: boolean // 是否已完成（状态标志）
  donePromise: Promise<void> // 任务完成 promise（SSE 端点用它等待结束）
  resolveDone: () => void // 完成 promise 的 resolve 函数
}

// ============ 内存数据结构 ============

/**
 * 任务注册表：streamId → SdkStreamTask
 *
 * 存储所有流式任务的运行时数据
 */
const tasks = new Map<string, SdkStreamTask>()

/**
 * 会话索引：sessionId → streamId
 *
 * 用于快速查找指定会话的当前活跃任务
 * 保证同一会话同时只有一个活跃任务
 */
const sessionIndex = new Map<string, string>()

/**
 * 任务存活时间：5 分钟
 *
 * 任务完成后，在内存中保留此时间以供断线重连
 * 超过此时间后被清理，后续重连走 DB 历史消息
 */
const TASK_TTL_MS = 5 * 60 * 1000

// ============ 文件产物检测 ============

/**
 * 文件操作工具集合
 *
 * 这些工具的调用会产生文件产物，需要注入 data-artifact chunk
 */
const FILE_OPERATION_TOOLS = new Set(["write_file", "edit_file", "read_file"])

function isFileOperationTool(toolName: string): boolean {
  return FILE_OPERATION_TOOLS.has(toolName)
}

/**
 * 根据文件扩展名推断产物类型
 */
function inferArtifactType(filePath: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filePath)
  const ext = match?.[1]?.toLowerCase()
  if (!ext) return "text"
  if (
    ["ts", "tsx", "js", "jsx", "json", "py", "sql", "css", "html"].includes(ext)
  )
    return "code"
  if (ext === "csv") return "sheet"
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image"
  return "text"
}

// ============ 内部工具函数 ============

/**
 * 清理过期的已完成任务
 *
 * 从任务注册表和会话索引中移除超过 TTL 的已完成任务
 */
function cleanup(): void {
  const now = Date.now()
  for (const [id, task] of tasks) {
    if (
      task.completed &&
      now - parseInt(id.replace(/[^0-9]/g, ""), 36) > TASK_TTL_MS
    ) {
      task.subscribers.clear()
      tasks.delete(id)
      if (sessionIndex.get(task.sessionId) === id) {
        sessionIndex.delete(task.sessionId)
      }
    }
  }
}

/**
 * 根据 employeeId 获取对应的 Agent 实例
 *
 * 复用 agent.ts 的缓存机制
 */
async function resolveAgent(employeeId?: string) {
  const cacheKey = employeeId || "__default__"
  let systemPrompt: string | undefined

  if (employeeId) {
    const emp = await getEmployee(employeeId)
    systemPrompt = emp?.systemPrompt || undefined
  }

  return getAgent(cacheKey, systemPrompt)
}

/**
 * 向所有 SSE 订阅者广播 chunk
 *
 * 订阅者抛出异常时自动移除，避免影响其他订阅者
 */
function broadcast(task: SdkStreamTask, event: UIMessageChunk): void {
  for (const sub of task.subscribers) {
    try {
      sub(event)
    } catch {
      task.subscribers.delete(sub)
    }
  }
}

// ============ 任务管理 ============

/**
 * 创建新的 SDK 流任务
 *
 * 防并发机制：
 * - 检查会话索引，如果已有未完成的活跃任务则拒绝创建
 * - 如果任务已完成，清理旧索引后允许创建新任务
 */
function createSdkTask(
  streamId: string,
  sessionId: string
): SdkStreamTask | null {
  const existing = sessionIndex.get(sessionId)
  if (existing) {
    const existingTask = tasks.get(existing)
    if (existingTask && !existingTask.completed) {
      return null
    }
    sessionIndex.delete(sessionId)
  }

  let resolveDone: () => void
  const donePromise = new Promise<void>((resolve) => (resolveDone = resolve))

  const task: SdkStreamTask = {
    id: streamId,
    sessionId,
    status: "streaming",
    content: "",
    errorMessage: null,
    messageId: null,
    chunks: [],
    subscribers: new Set(),
    abortController: new AbortController(),
    completed: false,
    donePromise,
    resolveDone: resolveDone!,
  }

  tasks.set(streamId, task)
  sessionIndex.set(sessionId, streamId)

  return task
}

// ============ 后台执行 ============

/**
 * 在后台运行 agent 的流式对话
 *
 * 这是 SDK 流的核心异步流程：
 *
 * 1. 根据 employeeId 获取对应的 Agent 实例
 * 2. 转换消息格式并注入技能提示（如果指定了 skill）
 * 3. 启动 agent.stream()，通过 signal 支持手动取消
 * 4. 迭代 toUIMessageStream() 的每个 chunk：
 *    a. 缓冲到 task.chunks（用于断线重连回放）
 *    b. 累积文本内容到 task.content（用于持久化）
 *    c. 检测文件工具调用 → 读取文件 → 注入 data-artifact chunk
 *    d. 广播给所有 SSE 订阅者
 * 5. 完成后（正常结束/手动取消/异常）：
 *    a. 持久化 assistant 消息到数据库
 *    b. 同步文件产物
 *    c. 广播结束事件（finish/abort/error）
 *    d. 清理订阅者，延迟清理内存
 */
async function runInBackground(
  task: SdkStreamTask,
  sessionId: string,
  messages: UIMessage[],
  employeeId?: string,
  skill?: string
) {
  try {
    const agent = await resolveAgent(employeeId)

    const config = { configurable: { thread_id: sessionId } }
    const langchainMessages = await toBaseMessages(messages)

    // 指定技能时，将技能提示注入到最后一条用户消息
    if (skill) {
      const lastMsg = langchainMessages[langchainMessages.length - 1]
      if (lastMsg && lastMsg._getType() === "human") {
        const content = lastMsg.content
        lastMsg.content = applySkillHint(
          typeof content === "string" ? content : "",
          skill
        )
      }
    }

    const graphStream = await agent.stream(
      { messages: langchainMessages },
      { ...config, streamMode: ["messages"] }
    )

    const uiStream = toUIMessageStream(graphStream)
    const sessionDir = getSessionDir(sessionId)

    // 记录待匹配的文件工具调用（tool-input → tool-output 配对）
    const pendingFileTools = new Map<string, { toolName: string; input: any }>()

    // 迭代每个 UIMessageChunk
    for await (const chunk of uiStream) {
      // 手动取消时立即停止消费
      if (task.abortController.signal.aborted) break

      // 缓冲 chunk（用于断线重连回放）
      task.chunks.push(chunk)

      // 累积文本内容（用于持久化到数据库）
      if (chunk.type === "text-delta") {
        task.content += chunk.delta
      }

      // 检测文件工具输入 → 缓存等待 tool-output
      if (
        chunk.type === "tool-input-available" &&
        "dynamic" in chunk &&
        chunk.dynamic === true &&
        "toolName" in chunk
      ) {
        const { toolName, input } = chunk as any
        if (isFileOperationTool(toolName)) {
          pendingFileTools.set(chunk.toolCallId, {
            toolName,
            input,
          })
        }
      }

      // 检测文件工具输出 → 读取文件内容 → 生成 data-artifact chunk
      if (chunk.type === "tool-output-available") {
        const pending = pendingFileTools.get(chunk.toolCallId)
        if (pending) {
          const filePath = pending.input?.file_path
          if (typeof filePath === "string") {
            try {
              const content = fs.readFileSync(
                path.join(sessionDir, filePath),
                "utf-8"
              )
              const artifactChunk = {
                type: "data-artifact",
                id: `artifact:${chunk.toolCallId}`,
                data: {
                  id: `artifact:${chunk.toolCallId}`,
                  type: inferArtifactType(filePath),
                  title: path.basename(filePath),
                  content,
                  filePath,
                  toolName: pending.toolName,
                },
              } as any
              task.chunks.push(artifactChunk)
              broadcast(task, artifactChunk)
            } catch {
              // file write may have failed
            }
          }
          pendingFileTools.delete(chunk.toolCallId)
        }
      }

      // 广播给所有 SSE 订阅者
      broadcast(task, chunk)
    }

    // 处理手动取消：持久化已有部分内容
    if (task.abortController.signal.aborted) {
      task.status = "cancelled"
      task.completed = true

      if (task.content) {
        const savedMessage = await createMessage(
          sessionId,
          "assistant",
          task.content
        )
        task.messageId = savedMessage.id
      }

      await detectNewArtifacts(sessionId)
      await updateSession(sessionId, {})
      broadcast(task, { type: "abort", reason: "User cancelled" } as any)
      task.subscribers.clear()
      setTimeout(cleanup, TASK_TTL_MS)
      task.resolveDone()
      return
    }

    // 正常完成：持久化完整消息
    const savedMessage = await createMessage(
      sessionId,
      "assistant",
      task.content
    )
    task.messageId = savedMessage.id
    task.status = "completed"
    task.completed = true

    await detectNewArtifacts(sessionId)
    await updateSession(sessionId, {})

    broadcast(task, { type: "finish", finishReason: "stop" } as any)
    task.subscribers.clear()
    setTimeout(cleanup, TASK_TTL_MS)
    task.resolveDone()
  } catch (error: any) {
    // 异常处理：持久化已有内容，广播错误
    const errMsg = error?.message || "Unknown error"

    task.status = "failed"
    task.completed = true
    task.errorMessage = errMsg

    if (task.content) {
      try {
        const savedMessage = await createMessage(
          sessionId,
          "assistant",
          task.content
        )
        task.messageId = savedMessage.id
      } catch {
        // persist failed, ignore
      }
    }

    await detectNewArtifacts(sessionId)
    await updateSession(sessionId, {})

    broadcast(task, { type: "error", errorText: errMsg } as UIMessageChunk)
    task.subscribers.clear()
    setTimeout(cleanup, TASK_TTL_MS)
    task.resolveDone()
  }
}

// ============ 公开 API ============

/**
 * 启动 SDK 流任务的结果类型
 */
export type StartSdkStreamResult =
  | {
      ok: true
      streamId: string
      replay: UIMessageChunk[] // 已缓冲的 chunks（首次通常为空）
      subscribe: (fn: Subscriber) => void
      unsubscribe: (fn: Subscriber) => void
      waitUntilDone: () => Promise<void> // 等待任务完成的 promise
    }
  | { ok: false; error: string; activeStreamId?: string }

/**
 * 启动 SDK 流任务
 *
 * 执行逻辑：
 * 1. 检查会话是否已有活跃任务（防并发）
 * 2. 保存用户消息到数据库
 * 3. 注册内存任务，用 setTimeout 在后台启动 agent
 * 4. 返回订阅接口，SSE 端点通过它接收实时 chunks
 *
 * @param sessionId 会话 ID
 * @param messages AI SDK 格式的消息历史（UIMessage[]）
 * @param employeeId 员工 ID（可选）
 * @param skill 技能名称（可选）
 * @returns 任务启动结果
 */
export async function startSdkStream(
  sessionId: string,
  messages: UIMessage[],
  employeeId?: string,
  skill?: string
): Promise<StartSdkStreamResult> {
  // 防并发：检查会话是否已有活跃任务
  const existingStreamId = sessionIndex.get(sessionId)
  if (existingStreamId) {
    const existingTask = tasks.get(existingStreamId)
    if (existingTask && !existingTask.completed) {
      return {
        ok: false,
        error: "Session already has an active stream",
        activeStreamId: existingStreamId,
      }
    }
  }

  // 创建新任务
  const streamId = nanoid()
  const task = createSdkTask(streamId, sessionId)
  if (!task) {
    return {
      ok: false,
      error: "Session already has an active stream",
    }
  }

  // 保存用户消息到数据库（await 确保断线重连时 DB 中有完整消息）
  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.role === "user") {
    const userText = lastMessage.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim()
    try {
      await createMessage(sessionId, "user", userText || "", {
        parts: lastMessage.parts,
      })
    } catch (err) {
      console.error(`[sdk-stream:${streamId}] save user message failed:`, err)
    }
  }

  // 后台启动 agent（延迟 50ms，让 SSE 端点先返回响应）
  setTimeout(() => {
    runInBackground(task, sessionId, messages, employeeId, skill).catch((err) =>
      console.error(`[sdk-stream:${streamId}] unhandled error:`, err)
    )
  }, 50)

  return {
    ok: true,
    streamId,
    replay: task.chunks,
    subscribe: (fn: Subscriber) => {
      task.subscribers.add(fn)
    },
    unsubscribe: (fn: Subscriber) => {
      task.subscribers.delete(fn)
    },
    waitUntilDone: () => task.donePromise,
  }
}

/**
 * 断线重连的结果类型
 */
export type ResumeSdkStreamResult =
  | {
      ok: true
      replay: UIMessageChunk[] // 需要回放的缓冲 chunks
      subscribe: (fn: Subscriber) => void
      unsubscribe: (fn: Subscriber) => void
      waitUntilDone: () => Promise<void>
      status: string
    }
  | { ok: false }

/**
 * 断线重连
 *
 * 用于 GET /chat/stream 端点：
 * - 活跃任务：返回缓冲 chunks + 订阅接口（回放后接续实时流）
 * - 已结束/不存在：返回 { ok: false }，前端用 DB 历史消息
 *
 * @param sessionId 会话 ID
 * @returns 重连结果
 */
export function resumeSdkStream(sessionId: string): ResumeSdkStreamResult {
  const streamId = sessionIndex.get(sessionId)
  if (!streamId) return { ok: false }

  const task = tasks.get(streamId)
  if (!task || task.completed) {
    sessionIndex.delete(sessionId)
    return { ok: false }
  }

  return {
    ok: true,
    replay: task.chunks,
    status: task.status,
    subscribe: (fn: Subscriber) => {
      task.subscribers.add(fn)
    },
    unsubscribe: (fn: Subscriber) => {
      task.subscribers.delete(fn)
    },
    waitUntilDone: () => task.donePromise,
  }
}

/**
 * 手动取消流任务
 *
 * 调用 abortController.abort() 中断 agent 生成。
 * runInBackground 检测到 signal 后会持久化已有部分内容。
 *
 * @param sessionId 会话 ID
 * @returns 是否成功取消（任务不存在或已完成返回 false）
 */
export function cancelSdkStream(sessionId: string): boolean {
  const streamId = sessionIndex.get(sessionId)
  if (!streamId) return false

  const task = tasks.get(streamId)
  if (!task || task.completed) return false

  task.abortController.abort()
  return true
}

/**
 * 获取会话的流状态
 *
 * @param sessionId 会话 ID
 * @returns 流状态信息
 */
export function getSdkStreamStatus(sessionId: string): {
  active: boolean
  streamId?: string
  status?: string
  content?: string
  messageId?: number | null
} {
  const streamId = sessionIndex.get(sessionId)
  if (!streamId) return { active: false }

  const task = tasks.get(streamId)
  if (!task || task.completed) {
    if (task) {
      sessionIndex.delete(sessionId)
      return {
        active: false,
        streamId: task.id,
        status: task.status,
        content: task.content,
        messageId: task.messageId,
      }
    }
    return { active: false }
  }

  return {
    active: true,
    streamId: task.id,
    status: task.status,
  }
}
