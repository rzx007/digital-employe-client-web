import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { getMessages } from "../services/message-service"
import {
  chat,
  startStream,
  resumeStream,
  cancelStream,
  getStreamStatus,
  resolveStream,
} from "../services/agent-service"
import { getSession } from "../services/session-service"
import type { SendMessageInput, StreamEvent } from "../types"

const app = new Hono()

app.get("/:id/messages", async (c) => {
  const id = c.req.param("id")
  const page = Number(c.req.query("page")) || 1
  const pageSize = Number(c.req.query("pageSize")) || 50

  const result = await getMessages(id, page, pageSize)
  return c.json(result)
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
    const result = await chat(id, body.message)
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
  const body = await c.req.json<SendMessageInput>()

  if (!body.message || typeof body.message !== "string") {
    return c.json({ error: "message is required (string)" }, 400)
  }

  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)

  const result = startStream(id, body.message)

  if (!result.ok) {
    return c.json(
      { error: result.error, activeStreamId: result.activeStreamId },
      409
    )
  }

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      data: JSON.stringify({ type: "stream_start", streamId: result.streamId }),
    })

    const unsub = result.subscribe((event: StreamEvent) => {
      stream
        .writeSSE({
          data: JSON.stringify(event),
        })
        .catch(() => {})
    })

    await stream.onAbort(() => {
      unsub()
    })
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

      const unsub = result.subscribe((event: StreamEvent) => {
        stream
          .writeSSE({
            data: JSON.stringify(event),
          })
          .catch(() => {})
      })

      await stream.onAbort(() => {
        unsub()
      })
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
