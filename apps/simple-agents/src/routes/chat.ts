/**
 * Chat Routes - 对话路由
 *
 * 提供对话相关的 HTTP 端点：
 *
 * 1. GET  /:id/messages          - 获取会话的消息历史
 * 2. POST /:id/chat              - 同步对话（非流式）
 * 3. POST /:id/chat/stream       - AI SDK 标准流式对话（SSE + UIMessageChunk）
 * 4. POST /:id/chat/raw-stream   - 原始 LangChain 事件流式对话（SSE + 自定义事件）
 * 5. GET  /:id/stream/:streamId  - 恢复/订阅指定流（仅 raw-stream）
 * 6. POST /:id/stream/:streamId/cancel - 取消指定流（仅 raw-stream）
 * 7. GET  /:id/stream            - 查询会话的流状态（仅 raw-stream）
 *
 * 流式端点对比：
 * - /chat/stream (AI SDK): 使用 toUIMessageStream() 输出标准 UIMessageChunk，
 *   适用于前端 AI SDK useChat 直接消费
 * - /chat/raw-stream (Raw): 手动迭代 streamEvents() 输出自定义 StreamEvent，
 *   保留完整 LangChain 事件粒度，支持断线重连和后台任务
 */

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import type { UIMessage } from "ai"
import { getMessages } from "../services/message-service"
import { chat, chatStreamResponse } from "../services/agent-service"
import {
  startStream,
  resumeStream,
  cancelStream,
  getStreamStatus,
  resolveStream,
} from "../services/agent-stream-raw"
import { getSession } from "../services/session-service"
import type { SendMessageInput, StreamEvent } from "../types"

const app = new Hono()

app.get("/:id/messages", async (c) => {
  const id = c.req.param("id")
  const page = Number(c.req.query("page")) || 1
  const pageSize = Number(c.req.query("pageSize")) || 50

  const result = await getMessages(id, page, pageSize)
  return c.json(result.data)
})

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

app.post("/:id/chat/stream", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<{ messages: UIMessage[]; skill?: string }>()

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "messages array is required" }, 400)
  }
 
  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)

  const employeeId = session.employeeId || undefined

  try {
    return await chatStreamResponse(id, body.messages, employeeId, body.skill)
  } catch (error: any) {
    return c.json({ error: error.message || "AI SDK stream failed" }, 500)
  }
})

app.post("/:id/chat/raw-stream", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<SendMessageInput>()

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
          event.type === "cancelled"
        ) {
          unsub()
          return
        }
      }
      await stream.sleep(100)
    }
  })
})

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
            event.type === "cancelled"
          ) {
            unsub()
            return
          }
        }
        await stream.sleep(100)
      }
    })
  }

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
