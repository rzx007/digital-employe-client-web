/**
 * Agent Stream (Raw) Service - 基于 LangGraph stream() 的流式事件服务
 *
 * 核心职责：
 * 1. 封装 DeepAgent 的 stream() 调用 (streamMode: ["messages", "updates"])
 * 2. 管理流式对话的生命周期（启动/取消/恢复）
 * 3. 将 stream() 输出广播为简化的 StreamEvent
 * 4. 实现三级降级的流恢复机制（内存 → 数据库 → 消息表）
 *
 * 架构要点：
 * - agent 调用与 SSE 连接完全解耦
 * - 后台任务独立运行，客户端可随时断开/重连
 * - 通过 stream-registry 管理事件订阅和广播
 * - 使用 LangGraph stream() 替代 streamEvents()，减少冗余事件
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
import { Command } from "@langchain/langgraph"

async function resolveAgent(employeeId?: string) {
  const cacheKey = employeeId || "__default__"
  let systemPrompt: string | undefined

  if (employeeId) {
    const emp = await getEmployee(employeeId)
    systemPrompt = emp?.systemPrompt || undefined
  }

  return getAgent(cacheKey, systemPrompt)
}

export type StartStreamResult =
  | {
      ok: true
      streamId: string
      subscribe: (fn: (event: StreamEvent) => void) => () => void
    }
  | { ok: false; error: string; activeStreamId?: string }

/**
 * 启动流式对话
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
 * 启动流式对话（resume 模式 — 用于 interrupt 审批后恢复）
 */
export function startStreamWithResume(
  sessionId: string,
  resumeDecisions: Record<string, { type: string; args?: Record<string, unknown> }>,
  employeeId?: string
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
    runAgentInBackgroundResume(sessionId, resumeDecisions, task, employeeId).catch(
      (err) => {
        console.error(`[stream:${streamId}] resume error:`, err)
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
 * 后台运行 Agent（fresh 场景）
 *
 * 使用 agent.stream() + streamMode=["messages", "updates"]
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

    if (skill) {
      const lastMsg = langchainMessages[langchainMessages.length - 1]
      if (lastMsg && lastMsg.role === "user") {
        lastMsg.content = applySkillHint(
          typeof lastMsg.content === "string" ? lastMsg.content : "",
          skill
        )
      }
    }

    const eventStream = await agent.stream(
      { messages: langchainMessages as any },
      {
        configurable: { thread_id: sessionId },
        streamMode: ["messages", "updates"],
        signal: task.abortController.signal,
      } as any
    )

    const result = await processStreamEvents(eventStream, task, sessionId)

    if (result.interrupted) {
      broadcast(task, {
        type: "interrupt",
        interrupts: result.interrupts,
      })
      completeTask(task.id, null)
      return
    }

    await finalizeStream(task, sessionId, result.fullContent)
  } catch (error: any) {
    if (error?.name === "AbortError") {
      await getDb()
        .update(streamTasks)
        .set({ status: "cancelled", updatedAt: sql`datetime('now')` })
        .where(eq(streamTasks.id, task.id))
      completeTask(task.id, null)
      return
    }

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
 * 后台运行 Agent（resume 场景 — interrupt 审批后恢复）
 */
async function runAgentInBackgroundResume(
  sessionId: string,
  resumeDecisions: Record<string, { type: string; args?: Record<string, unknown> }>,
  task: ActiveTask,
  employeeId?: string
) {
  try {
    await getDb().insert(streamTasks).values({
      id: task.id,
      sessionId,
      status: "streaming",
      content: "",
    })

    broadcast(task, { type: "stream_start", streamId: task.id })

    const agent = await resolveAgent(employeeId)

    const decisions = Object.entries(resumeDecisions).map(
      ([toolCallId, d]) => ({ toolCallId, ...d })
    )
    const command = new Command({ resume: { decisions } })

    const eventStream = await agent.stream(command, {
      configurable: { thread_id: sessionId },
      streamMode: ["messages", "updates"],
      signal: task.abortController.signal,
    } as any)

    const result = await processStreamEvents(eventStream, task, sessionId)

    if (result.interrupted) {
      broadcast(task, {
        type: "interrupt",
        interrupts: result.interrupts,
      })
      completeTask(task.id, null)
      return
    }

    await finalizeStream(task, sessionId, result.fullContent)
  } catch (error: any) {
    if (error?.name === "AbortError") {
      await getDb()
        .update(streamTasks)
        .set({ status: "cancelled", updatedAt: sql`datetime('now')` })
        .where(eq(streamTasks.id, task.id))
      completeTask(task.id, null)
      return
    }

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

interface StreamResult {
  fullContent: string
  interrupted: boolean
  interrupts: any[]
}

/**
 * 处理 stream() 输出事件
 *
 * stream(streamMode=["messages","updates"]) 输出格式为 [modeName, payload] 元组：
 * - ["messages", [AIMessageChunk, metadata]]
 * - ["updates", {nodeName: stateUpdate}]
 * - ["updates", {"__interrupt__": [...]}]
 */
async function processStreamEvents(
  eventStream: AsyncIterable<any>,
  task: ActiveTask,
  _sessionId: string
): Promise<StreamResult> {
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

    // 元组格式: [mode, data]
    const [mode, data] = event

    if (mode === "messages") {
      const [chunk, metadata] = data

      // 文本 token
      if (
        typeof chunk?.content === "string" &&
        chunk.content.length > 0
      ) {
        fullContent += chunk.content
        tokenCount++
        task.content = fullContent

        broadcast(task, {
          type: "messages",
          chunk: {
            content: chunk.content,
            tool_call_chunks: chunk.tool_call_chunks || [],
            tool_calls: chunk.tool_calls || [],
            additional_kwargs: chunk.additional_kwargs || {},
          },
          metadata: metadata || {},
        })

        if (
          tokenCount % 10 === 0 ||
          Date.now() - lastFlush > FLUSH_INTERVAL
        ) {
          await flushToDb()
        }
      }

      // 工具调用参数流式片段
      if (Array.isArray(chunk?.tool_call_chunks) && chunk.tool_call_chunks.length > 0) {
        broadcast(task, {
          type: "messages",
          chunk: {
            content: "",
            tool_call_chunks: chunk.tool_call_chunks,
            tool_calls: chunk.tool_calls || [],
            additional_kwargs: chunk.additional_kwargs || {},
          },
          metadata: metadata || {},
        })
      }

      // 完整工具调用（某些模型一次输出完整 tool_calls）
      if (
        !chunk?.content &&
        Array.isArray(chunk?.tool_calls) &&
        chunk.tool_calls.length > 0
      ) {
        broadcast(task, {
          type: "messages",
          chunk: {
            content: "",
            tool_call_chunks: [],
            tool_calls: chunk.tool_calls,
            additional_kwargs: chunk.additional_kwargs || {},
          },
          metadata: metadata || {},
        })
      }
    } else if (mode === "updates") {
      // 检测 interrupt
      if (data && typeof data === "object" && "__interrupt__" in data) {
        return {
          fullContent,
          interrupted: true,
          interrupts: data.__interrupt__,
        }
      }

      broadcast(task, { type: "updates", data })
    }
  }

  return {
    fullContent,
    interrupted: false,
    interrupts: [],
  }
}

/**
 * 流结束后的收尾工作：保存消息、更新任务状态、同步产物
 */
async function finalizeStream(
  task: ActiveTask,
  sessionId: string,
  fullContent: string
) {
  const savedMessage = await createMessage(sessionId, "assistant", fullContent)

  await getDb()
    .update(streamTasks)
    .set({
      content: fullContent,
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
}

export type ResumeResult =
  | {
      ok: true
      task: ActiveTask
      subscribe: (fn: (event: StreamEvent) => void) => () => void
    }
  | { ok: false; error: string }

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

export function cancelStream(streamId: string): boolean {
  return cancelTask(streamId)
}

export type StreamStatus = {
  active: boolean
  streamId?: string
  status?: string
  lastStreamId?: string
  lastStatus?: string
  lastMessageId?: number | null
}

export function getStreamStatus(sessionId: string): StreamStatus {
  const task = getActiveTaskForSession(sessionId)
  if (task) {
    return { active: true, streamId: task.id, status: task.status }
  }
  return { active: false }
}

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

export async function getLatestStreamTask(sessionId: string) {
  const [row] = await getDb()
    .select()
    .from(streamTasks)
    .where(eq(streamTasks.sessionId, sessionId))
    .orderBy(desc(streamTasks.createdAt))
    .limit(1)

  return row || null
}
