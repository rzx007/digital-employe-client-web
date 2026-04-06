/**
 * Chat Routes - 对话路由
 *
 * 提供对话相关的 HTTP 端点：
 *
 * === 消息历史 ===
 * 1. GET  /:id/messages              - 获取会话的消息历史（分页）
 *
 * === 同步对话 ===
 * 2. POST /:id/chat                  - 同步对话（非流式，阻塞到 agent 完成）
 *
 * === AI SDK 流式对话（前端 useChat 直接消费） ===
 * 3. POST /:id/chat/stream           - 首次发送，启动后台 agent 流任务，返回 SSE
 * 4. GET  /:id/chat/stream           - 断线重连：回放缓存 chunks + 接续实时流（204 = 已结束）
 * 5. POST /:id/chat/stream/stop     - 手动停止 agent（abort + 持久化已有内容）
 *
 * === Raw 流式对话（前端 SimpleAgentsTransport 使用） ===
 * 6. POST /:id/chat/raw-stream       - 启动 raw 流（LangGraph stream() + SSE）
 * 7. POST /:id/chat/raw-stream/resume - 恢复 raw 流（interrupt 审批后）
 * 8. GET  /:id/stream/:streamId      - 恢复/订阅指定 raw 流
 * 9. POST /:id/stream/:streamId/cancel - 取消指定 raw 流
 * 10. GET /:id/stream                - 查询 raw 流状态
 *
 * 流式端点对比：
 *
 * ┌─────────────────┬──────────────────────────┬──────────────────────────────────┐
 * │                 │ AI SDK /chat/stream      │ Raw /chat/raw-stream              │
 * ├─────────────────┼──────────────────────────┼──────────────────────────────────┤
 * │ 数据格式         │ UIMessageChunk          │ 自定义 StreamEvent                │
 * │ SSE 断开        │ agent 继续运行           │ agent 继续运行                   │
 * │ 断线重连        │ GET 自动回放+续接       │ GET/:streamId 回放+续接         │
 * │ 手动停止        │ POST /stop               │ POST /:streamId/cancel          │
 * │ 前端消费        │ useChat(resume:true)     │ 自定义 SSE 客户端               │
 * │ 持久化           │ 完成后自动存 DB         │ 完成后自动存 DB                 │
 * └─────────────────┴──────────────────────────┴──────────────────────────────────┘
 *
 * SSE 端点公共模式：
 * - 订阅注册表的实时 chunks（通过 subscriber 回调）
 * - SSE 断开时只取消订阅（unsub），不取消 agent
 * - 检测到结束事件（finish/abort/error）后结束 SSE 循环
 * - 使用 queue + sleep(50ms) 的轮询模式消费 subscriber 回调
 */

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { UIMessage, UIMessageChunk } from "ai"
import { getMessages } from "../services/message-service"
import { chat } from "../services/agent-service"
import {
  startSdkStream,
  resumeSdkStream,
  cancelSdkStream,
} from "../services/agent-stream-sdk"
import {
  startStream,
  startStreamWithResume,
  resumeStream,
  cancelStream,
  getStreamStatus,
  resolveStream,
} from "../services/agent-stream-raw"
import { getSession } from "../services/session-service"
import type { SendMessageInput, StreamEvent } from "../types"

const app = new Hono()

// ============ 消息历史 ============

/**
 * GET /:id/messages
 *
 * 分页获取会话的消息历史
 *
 * @param id - 会话 ID
 * @param page - 页码（默认 1）
 * @param pageSize - 每页条数（默认 50）
 */
app.get("/:id/messages", async (c) => {
  const id = c.req.param("id")
  const page = Number(c.req.query("page")) || 1
  const pageSize = Number(c.req.query("pageSize")) || 50

  const result = await getMessages(id, page, pageSize)
  return c.json(result.data)
})

// ============ 同步对话 ============

/**
 * POST /:id/chat
 *
 * 同步对话：阻塞到 agent 完成后返回完整回复
 * 仅在有活跃流时返回 409 拒绝请求（由 raw-stream 注册表检查）
 *
 * @param body.message - 用户消息文本
 * @param body.skill - 技能名称（可选，注入到消息中）
 */
app.post("/:id/chat", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<SendMessageInput>()

  if (!body.message || typeof body.message !== "string") {
    return c.json({ error: "message is required (string)" }, 400)
  }

  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)

  const status = getStreamStatus(id)
  if (status.active) {
    return c.json(
      {
        error: "Session has an active stream",
        activeStreamId: status.streamId,
      },
      409
    )
  }

  try {
    const employeeId = session.employeeId || undefined
    const result = await chat(id, body.message, employeeId, body.skill)
    return c.json({
      content: result.content,
      messageId: result.message.id,
    })
  } catch (error: any) {
    return c.json({ error: error.message || "Agent invocation failed" }, 500)
  }
})

// ============ AI SDK 流式对话 ============

/**
 * POST /:id/chat/stream
 *
 * 启动 AI SDK 流式对话（前端 useChat 的主要入口）
 *
 * 流程：
 * 1. 调用 startSdkStream() 启动后台 agent 任务
 * 2. 返回 SSE 流，将 UIMessageChunk 实时推送给前端
 * 3. SSE 断开时只取消订阅，agent 继续在后台运行
 * 4. 前端可通过 GET 重连恢复
 *
 * @param body.messages - AI SDK UIMessage[] 消息历史
 * @param body.skill - 技能名称（可选）
 */
app.post("/:id/chat/stream", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ messages: UIMessage[]; skill?: string }>()

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "messages array is required" }, 400)
  }

  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)

  const employeeId = session.employeeId || undefined
  const result = await startSdkStream(id, body.messages, employeeId, body.skill)

  if (!result.ok) {
    return c.json(
      { error: result.error, activeStreamId: result.activeStreamId },
      409
    )
  }

  // SSE 流：先回放缓存 chunks，再订阅实时 chunks
  return streamSSE(c, async (stream) => {
    // 回放缓存区中已有的 chunks（首次发送时通常为空）
    for (const chunk of result.replay) {
      await stream.writeSSE({ data: JSON.stringify(chunk) })
    }

    // 订阅实时 chunks，通过队列异步写入 SSE
    const queue: UIMessageChunk[] = []
    const sub = (chunk: UIMessageChunk) => queue.push(chunk)
    result.subscribe(sub)

    // SSE 断开时只取消订阅，不取消 agent（agent 继续后台运行）
    let aborted = false
    stream.onAbort(() => {
      aborted = true
      result.unsubscribe(sub)
    })

    // 轮询队列写入 SSE，检测到结束事件后退出
    while (!aborted) {
      while (queue.length > 0) {
        const chunk = queue.shift()!
        await stream.writeSSE({ data: JSON.stringify(chunk) })
        // 结束事件：取消订阅并关闭 SSE
        if (
          chunk.type === "finish" ||
          chunk.type === "abort" ||
          chunk.type === "error"
        ) {
          result.unsubscribe(sub)
          return
        }
      }
      await stream.sleep(50)
    }
  })
})

/**
 * GET /:id/chat/stream
 *
 * 断线重连端点（AI SDK useChat resume 时自动调用）
 *
 * 流程：
 * 1. 查询注册表，检查该会话是否有活跃的流任务
 * 2. 活跃 → 回放缓存 chunks + 订阅后续实时 chunks → SSE
 * 3. 已结束或不存在 → 返回 204，前端用 DB 历史消息
 *
 * 204 响应让 AI SDK 的 HttpChatTransport.reconnectToStream()
 * 返回 null，前端放弃重连，直接使用 loadMessages 加载历史
 */
app.get("/:id/chat/stream", async (c) => {
  const id = c.req.param("id")

  const result = resumeSdkStream(id)
  if (!result.ok) {
    return c.body(null, 204)
  }

  // SSE 流：回放缓存 chunks（断线期间积累的）+ 订阅后续实时 chunks
  return streamSSE(c, async (stream) => {
    // 先回放缓存区中所有已有 chunks（断线期间 agent 继续生成的）
    for (const chunk of result.replay) {
      await stream.writeSSE({ data: JSON.stringify(chunk) })
    }

    // 订阅后续实时 chunks
    const queue: UIMessageChunk[] = []
    const sub = (chunk: UIMessageChunk) => queue.push(chunk)
    result.subscribe(sub)

    let aborted = false
    stream.onAbort(() => {
      aborted = true
      result.unsubscribe(sub)
    })

    while (!aborted) {
      while (queue.length > 0) {
        const chunk = queue.shift()!
        await stream.writeSSE({ data: JSON.stringify(chunk) })
        if (
          chunk.type === "finish" ||
          chunk.type === "abort" ||
          chunk.type === "error"
        ) {
          result.unsubscribe(sub)
          return
        }
      }
      await stream.sleep(50)
    }
  })
})

/**
 * POST /:id/chat/stream/stop
 *
 * 手动停止当前流任务
 *
 * 调用 cancelSdkStream() 触发 abortController.abort()，
 * agent 收到 signal 后停止生成，runInBackground 会持久化已有部分内容。
 *
 * 与刷新/关闭页面的区别：
 * - 刷新/关闭：SSE 断开，agent 继续运行到自然结束
 * - 手动停止：abort agent，立即停止生成
 */
app.post("/:id/chat/stream/stop", async (c) => {
  const id = c.req.param("id")
  const success = cancelSdkStream(id)

  if (!success) {
    return c.json({ error: "No active stream" }, 404)
  }

  return c.json({ success: true })
})

// ============ Raw 流式对话（保留） ============

/**
 * POST /:id/chat/raw-stream
 *
 * 启动 raw 流式对话（前端 SimpleAgentsTransport 使用）
 *
 * 使用 LangGraph stream(streamMode=["messages","updates"]) + SSE 推送
 */
app.post("/:id/chat/raw-stream", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{
    message?: string
    skill?: string
  }>()

  if (!body.message || typeof body.message !== "string") {
    return c.json({ error: "message is required (string)" }, 400)
  }

  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)

  const employeeId = session.employeeId || undefined

  const result = startStream(id, body.message, employeeId, body.skill)

  if (!result.ok) {
    return c.json(
      { error: result.error, activeStreamId: result.activeStreamId },
      409
    )
  }

  return streamSSE(c, async (stream) => {
    const streamId = result.streamId
    const queue: StreamEvent[] = []

    await stream.writeSSE({
      data: JSON.stringify({ type: "stream_start", streamId }),
    })

    const unsub = result.subscribe((event: StreamEvent) => {
      queue.push(event)
    })

    let aborted = false
    stream.onAbort(() => {
      aborted = true
      unsub()
    })

    while (!aborted) {
      while (queue.length > 0) {
        const event = queue.shift()!
        await stream.writeSSE({ data: JSON.stringify(event) })
        if (
          event.type === "done" ||
          event.type === "error" ||
          event.type === "cancelled" ||
          event.type === "interrupt"
        ) {
          unsub()
          return
        }
      }
      await stream.sleep(100)
    }
  })
})

/**
 * POST /:id/chat/raw-stream/resume
 *
 * 恢复 raw 流（interrupt 审批后调用）
 *
 * 前端审批/回答后，发送 resumeDecisions 恢复 Agent 执行
 */
app.post("/:id/chat/raw-stream/resume", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{
    resumeDecisions: Record<
      string,
      { type: string; args?: Record<string, unknown> }
    >
  }>()

  if (!body.resumeDecisions || typeof body.resumeDecisions !== "object") {
    return c.json({ error: "resumeDecisions is required (object)" }, 400)
  }

  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)

  const employeeId = session.employeeId || undefined

  const result = startStreamWithResume(id, body.resumeDecisions, employeeId)

  if (!result.ok) {
    return c.json(
      { error: result.error, activeStreamId: result.activeStreamId },
      409
    )
  }

  return streamSSE(c, async (stream) => {
    const streamId = result.streamId
    const queue: StreamEvent[] = []

    await stream.writeSSE({
      data: JSON.stringify({ type: "stream_start", streamId }),
    })

    const unsub = result.subscribe((event: StreamEvent) => {
      queue.push(event)
    })

    let aborted = false
    stream.onAbort(() => {
      aborted = true
      unsub()
    })

    while (!aborted) {
      while (queue.length > 0) {
        const event = queue.shift()!
        await stream.writeSSE({ data: JSON.stringify(event) })
        if (
          event.type === "done" ||
          event.type === "error" ||
          event.type === "cancelled" ||
          event.type === "interrupt"
        ) {
          unsub()
          return
        }
      }
      await stream.sleep(100)
    }
  })
})

/**
 * GET /:id/stream/:streamId
 *
 * 恢复/订阅指定 raw 流（仅 raw-stream）
 *
 * - 已完成 → 返回 JSON 状态（completed/failed/cancelled + content）
 * - 活跃 → 返回 SSE（回放缓存 content + 订阅实时事件）
 * - 不存在 → 尝试从 DB stream_tasks 表恢复
 */
app.get("/:id/stream/:streamId", async (c) => {
  const streamId = c.req.param("streamId")

  const result = resumeStream(streamId)

  if (result.ok) {
    const { task } = result

    if (task.completed) {
      if (task.status === "completed") {
        return c.json({
          status: "completed",
          content: task.content,
          messageId: task.messageId,
          streamId: task.id,
        })
      }
      if (task.status === "failed") {
        return c.json({
          status: "failed",
          error: task.errorMessage,
          streamId: task.id,
        })
      }
      if (task.status === "cancelled") {
        return c.json({
          status: "cancelled",
          content: task.content,
          streamId: task.id,
        })
      }
    }

    return streamSSE(c, async (stream) => {
      const cachedContent = task.content

      if (cachedContent) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "recovery",
            content: cachedContent,
            streamId,
          }),
        })
      }

      const queue: StreamEvent[] = []

      const unsub = result.subscribe((event: StreamEvent) => {
        queue.push(event)
      })

      let aborted = false
      stream.onAbort(() => {
        aborted = true
        unsub()
      })

      while (!aborted) {
        while (queue.length > 0) {
          const event = queue.shift()!
          await stream.writeSSE({ data: JSON.stringify(event) })
          if (
            event.type === "done" ||
            event.type === "error" ||
            event.type === "cancelled" ||
            event.type === "interrupt"
          ) {
            unsub()
            return
          }
        }
        await stream.sleep(100)
      }
    })
  }

  // 内存注册表中找不到，尝试从 DB stream_tasks 表恢复
  const sessionId = c.req.param("id")
  const resolved = await resolveStream(sessionId)

  if (!resolved.ok) {
    return c.json({ error: "Stream not found or expired" }, 404)
  }

  if (resolved.streamId !== streamId) {
    return c.json(
      {
        error: "Stream not found or expired",
        latestStreamId: resolved.streamId,
        latestStatus: resolved.status,
      },
      404
    )
  }

  return c.json({
    status: resolved.status,
    content: resolved.content,
    error: resolved.errorMessage,
    messageId: resolved.messageId,
    streamId: resolved.streamId,
    source: resolved.source,
  })
})

/**
 * POST /:id/stream/:streamId/cancel
 *
 * 取消指定 raw 流（仅 raw-stream）
 */
app.post("/:id/stream/:streamId/cancel", async (c) => {
  const streamId = c.req.param("streamId")
  const cancelled = cancelStream(streamId)

  if (!cancelled) {
    return c.json(
      { error: "Stream not found, already completed, or expired" },
      404
    )
  }

  return c.json({ success: true, streamId })
})

/**
 * GET /:id/stream
 *
 * 查询 raw 流状态（仅 raw-stream）
 */
app.get("/:id/stream", async (c) => {
  const id = c.req.param("id")

  const status = getStreamStatus(id)
  if (status.active) {
    return c.json(status)
  }

  const resolved = await resolveStream(id)
  if (!resolved.ok) {
    return c.json({ active: false })
  }

  return c.json({
    active: false,
    lastStreamId: resolved.streamId,
    lastStatus: resolved.status,
    lastMessageId: resolved.messageId,
  })
})

export default app
