/**
 * Agent Stream (Raw) Service - 原始流式事件服务
 *
 * 核心职责：
 * 1. 封装 DeepAgent 的 streamEvents() 调用
 * 2. 管理流式对话的生命周期（启动/取消/恢复）
 * 3. 手动迭代 LangChain streamEvents 并广播自定义 StreamEvent
 * 4. 实现三级降级的流恢复机制（内存 → 数据库 → 消息表）
 *
 * 架构要点：
 * - agent 调用与 SSE 连接完全解耦
 * - 后台任务独立运行，客户端可随时断开/重连
 * - 通过 stream-registry 管理事件订阅和广播
 * - 对比 agent-service.ts 的 AI SDK 标准流：这里保留了完整的
 *   LangChain 事件粒度（on_chat_model_stream, on_tool_start 等）
 */

import type { StreamEvent } from "../types"
import { getAgent } from "../agent"
import {
  createMessage,
  getSessionMessages,
  getMessageById,
} from "./message-service"
import { updateSession } from "./session-service"
import { getDb } from "../db"
import { streamTasks } from "../db/schema"
import { eq, sql, desc } from "drizzle-orm"
import {
  createTask,
  getTask,
  getActiveTaskForSession,
  subscribe,
  broadcast,
  completeTask,
  failTask,
  cancelTask,
  unsubscribe,
  type ActiveTask,
} from "./stream-registry"
import { nanoid } from "nanoid"
import { getEmployee } from "./employee-service"
import {
  toLangchainMessages,
  detectNewArtifacts,
  applySkillHint,
} from "./agent-service"

/**
 * 将内部 Message 转换为 LangChain 消息格式
 *
 * @deprecated Use toLangchainMessages from agent-service.ts instead
 */

/**
 * 根据 employeeId 获取对应的 Agent 实例
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
 * 流式对话启动结果类型
 */
export type StartStreamResult =
  | {
      ok: true
      streamId: string
      subscribe: (fn: (event: StreamEvent) => void) => () => void
    }
  | { ok: false; error: string; activeStreamId?: string }

/**
 * 启动流式对话
 *
 * 核心设计：
 * - 同时只会有一个活跃的流式任务（通过 stream-registry 保证）
 * - agent 调用在后台运行（fire-and-forget），不阻塞 SSE 连接
 * - 客户端通过 subscribe() 订阅事件，通过返回的取消函数取消订阅
 */
export function startStream(
  sessionId: string,
  userMessage: string,
  employeeId?: string,
  skill?: string
): StartStreamResult {
  const activeTask = getActiveTaskForSession(sessionId)
  if (activeTask) {
    return {
      ok: false,
      error: "Session already has an active stream",
      activeStreamId: activeTask.id,
    }
  }

  const streamId = nanoid()
  const abortController = new AbortController()

  const task = createTask(streamId, sessionId, abortController)
  if (!task) {
    return {
      ok: false,
      error: "Failed to create stream task",
    }
  }

  setTimeout(() => {
    runAgentInBackground(sessionId, userMessage, task, employeeId, skill).catch(
      (err) => {
        console.error(`[stream:${streamId}] unhandled error:`, err)
      }
    )
  }, 50)

  return {
    ok: true,
    streamId,
    subscribe: (fn: (event: StreamEvent) => void) => {
      subscribe(streamId, fn)
      return () => unsubscribe(streamId, fn)
    },
  }
}

/**
 * 在后台运行 Agent 的流式对话（手动 streamEvents 迭代）
 *
 * 这是 raw stream 的核心异步流程：
 * 1. 保存用户消息到数据库
 * 2. 创建 stream_tasks 记录（用于恢复）
 * 3. 广播 stream_start 事件
 * 4. 根据 employeeId 获取对应的 Agent 实例
 * 5. 获取对话历史并调用 agent.streamEvents()
 * 6. 逐个 token 地广播事件给所有订阅者
 * 7. 定期将进度刷入数据库（每10个token或每2秒）
 * 8. 完成后保存代理回复、同步文件产物、更新任务状态
 */
async function runAgentInBackground(
  sessionId: string,
  userMessage: string,
  task: ActiveTask,
  employeeId?: string,
  skill?: string
) {
  try {
    await createMessage(sessionId, "user", userMessage)

    await getDb().insert(streamTasks).values({
      id: task.id,
      sessionId,
      status: "streaming",
      content: "",
    })

    broadcast(task, { type: "stream_start", streamId: task.id })

    const agent = await resolveAgent(employeeId)

    const history = await getSessionMessages(sessionId)
    const langchainMessages = toLangchainMessages(history)

    // 指定技能时，将技能提示注入到最后一条用户消息
    if (skill) {
      const lastMsg = langchainMessages[langchainMessages.length - 1]
      if (lastMsg && lastMsg.role === "user") {
        lastMsg.content = applySkillHint(
          typeof lastMsg.content === "string" ? lastMsg.content : "",
          skill
        )
      }
    }

    const config = { configurable: { thread_id: sessionId } }
    const eventStream = agent.streamEvents(
      { messages: langchainMessages as any },
      config
    )

    let fullContent = ""
    let tokenCount = 0
    const FLUSH_INTERVAL = 2000
    let lastFlush = Date.now()

    async function flushToDb() {
      await getDb()
        .update(streamTasks)
        .set({
          content: fullContent,
          status: "streaming",
          updatedAt: sql`datetime('now')`,
        })
        .where(eq(streamTasks.id, task.id))
      lastFlush = Date.now()
    }

    for await (const event of eventStream) {
      if (task.abortController.signal.aborted) break

      if (event.event === "on_chat_model_stream" && event.data?.chunk) {
        const chunk = event.data.chunk

        if (typeof chunk.content === "string" && chunk.content) {
          fullContent += chunk.content
          tokenCount++

          task.content = fullContent
          broadcast(task, { type: "token", content: chunk.content })

          if (
            tokenCount % 10 === 0 ||
            Date.now() - lastFlush > FLUSH_INTERVAL
          ) {
            await flushToDb()
          }
        }

        if (
          Array.isArray(chunk.tool_call_chunks) &&
          chunk.tool_call_chunks.length > 0
        ) {
          for (const tc of chunk.tool_call_chunks) {
            if (tc.name) {
              broadcast(task, {
                type: "tool_call_start",
                name: tc.name,
                index: tc.index,
                id: tc.id,
              })
            }
            if (tc.args) {
              broadcast(task, {
                type: "tool_call_delta",
                args: tc.args,
                index: tc.index,
              })
            }
          }
        }
      }

      if (event.event === "on_tool_start") {
        broadcast(task, {
          type: "tool_start",
          name: event.name,
          input: event.data?.input,
        })
      }

      if (event.event === "on_tool_end") {
        const output =
          typeof event.data?.output === "string"
            ? event.data.output
            : event.data?.output
        broadcast(task, { type: "tool_end", name: event.name, output })
      }

      if (
        event.event === "on_chain_start" &&
        Array.isArray(event.tags) &&
        event.tags.includes("agent")
      ) {
        broadcast(task, {
          type: "chain_start",
          name: event.name,
          input: event.data?.input,
        })
      }

      if (
        event.event === "on_chain_end" &&
        Array.isArray(event.tags) &&
        event.tags.includes("agent")
      ) {
        broadcast(task, {
          type: "chain_end",
          name: event.name,
          output: event.data?.output,
        })
      }
    }

    if (task.abortController.signal.aborted) {
      await getDb()
        .update(streamTasks)
        .set({ status: "cancelled", updatedAt: sql`datetime('now')` })
        .where(eq(streamTasks.id, task.id))
      completeTask(task.id, null)
      return
    }

    const savedMessage = await createMessage(
      sessionId,
      "assistant",
      fullContent
    )

    await flushToDb()
    await getDb()
      .update(streamTasks)
      .set({
        status: "completed",
        messageId: savedMessage.id,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(streamTasks.id, task.id))

    await detectNewArtifacts(sessionId)
    await updateSession(sessionId, {})

    broadcast(task, {
      type: "done",
      messageId: savedMessage.id,
      streamId: task.id,
    })

    completeTask(task.id, savedMessage.id)
  } catch (error: any) {
    const errMsg = error?.message || "Unknown error"

    await getDb()
      .update(streamTasks)
      .set({
        status: "failed",
        errorMessage: errMsg,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(streamTasks.id, task.id))

    failTask(task.id, errMsg)
  }
}

/**
 * 流恢复结果类型
 */
export type ResumeResult =
  | {
      ok: true
      task: ActiveTask
      subscribe: (fn: (event: StreamEvent) => void) => () => void
    }
  | { ok: false; error: string }

/**
 * 恢复/订阅指定的流
 */
export function resumeStream(streamId: string): ResumeResult {
  const task = getTask(streamId)
  if (!task) {
    return { ok: false, error: "Stream not found or expired" }
  }

  return {
    ok: true,
    task,
    subscribe: (fn: (event: StreamEvent) => void) => {
      subscribe(streamId, fn)
      return () => unsubscribe(streamId, fn)
    },
  }
}

/**
 * 取消指定的流
 */
export function cancelStream(streamId: string): boolean {
  return cancelTask(streamId)
}

/**
 * 流状态类型
 */
export type StreamStatus = {
  active: boolean
  streamId?: string
  status?: string
  lastStreamId?: string
  lastStatus?: string
  lastMessageId?: number | null
}

/**
 * 获取会话的流状态
 */
export function getStreamStatus(sessionId: string): StreamStatus {
  const task = getActiveTaskForSession(sessionId)
  if (task) {
    return { active: true, streamId: task.id, status: task.status }
  }
  return { active: false }
}

/**
 * 解析后的流类型
 */
export type ResolvedStream =
  | {
      ok: true
      source: "memory" | "db"
      status: "streaming" | "completed" | "failed" | "cancelled"
      content: string
      errorMessage?: string | null
      messageId?: number | null
      streamId: string
    }
  | { ok: false; error: string }

/**
 * 解析会话的流状态（支持页面重载恢复）
 */
export async function resolveStream(
  sessionId: string
): Promise<ResolvedStream> {
  const memTask = getActiveTaskForSession(sessionId)
  if (memTask) {
    return {
      ok: true,
      source: "memory",
      status: memTask.status,
      content: memTask.content,
      errorMessage: memTask.errorMessage,
      messageId: memTask.messageId,
      streamId: memTask.id,
    }
  }

  const latest = await getLatestStreamTask(sessionId)
  if (!latest) {
    return { ok: false, error: "No stream found for this session" }
  }

  if (latest.status === "completed" && latest.messageId) {
    const msg = await getMessageById(latest.messageId)
    return {
      ok: true,
      source: "db",
      status: "completed",
      content: msg?.content || latest.content,
      messageId: latest.messageId,
      streamId: latest.id,
    }
  }

  if (latest.status === "completed") {
    return {
      ok: true,
      source: "db",
      status: "completed",
      content: latest.content,
      messageId: latest.messageId,
      streamId: latest.id,
    }
  }

  if (latest.status === "streaming") {
    await getDb()
      .update(streamTasks)
      .set({
        status: "failed",
        errorMessage: "Server restarted or process crashed during streaming",
        content: latest.content,
        updatedAt: sql`datetime('now')`,
      })
      .where(eq(streamTasks.id, latest.id))

    return {
      ok: true,
      source: "db",
      status: "failed",
      content: latest.content,
      errorMessage: "Server restarted or process crashed during streaming",
      streamId: latest.id,
    }
  }

  if (latest.status === "failed") {
    return {
      ok: true,
      source: "db",
      status: "failed",
      content: latest.content,
      errorMessage: latest.errorMessage,
      streamId: latest.id,
    }
  }

  if (latest.status === "cancelled") {
    return {
      ok: true,
      source: "db",
      status: "cancelled",
      content: latest.content,
      streamId: latest.id,
    }
  }

  return { ok: false, error: "Unknown stream status" }
}

/**
 * 获取会话的最新流任务记录
 */
export async function getLatestStreamTask(sessionId: string) {
  const [row] = await getDb()
    .select()
    .from(streamTasks)
    .where(eq(streamTasks.sessionId, sessionId))
    .orderBy(desc(streamTasks.createdAt))
    .limit(1)

  return row || null
}
