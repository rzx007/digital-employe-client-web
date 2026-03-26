import "dotenv/config"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { agent, WORK_DIR } from "./agent"

const app = new Hono()

app.use("/*", cors())

app.get("/", (c) =>
  c.json({
    name: "simple-agents",
    version: "1.0.0",
    workDir: WORK_DIR,
    endpoints: {
      chat: "POST /api/chat",
      chatStream: "POST /api/chat/stream",
      rawStream: "POST /api/chat/raw-stream",
    },
  })
)

app.post("/api/chat", async (c) => {
  const body = await c.req.json()
  const { message, threadId } = body

  if (!message || typeof message !== "string") {
    return c.json({ error: "message is required (string)" }, 400)
  }

  const config = {
    configurable: {
      thread_id: threadId || `thread-${Date.now()}`,
    },
  }

  const result = await agent.invoke(
    { messages: [{ role: "user", content: message }] },
    config
  )

  const lastMessage = result.messages[result.messages.length - 1]
  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content)

  return c.json({
    content,
    threadId: config.configurable.thread_id,
    todos: result.todos,
  })
})

app.post("/api/chat/stream", async (c) => {
  const body = await c.req.json()
  const { message, threadId } = body

  if (!message || typeof message !== "string") {
    return c.json({ error: "message is required (string)" }, 400)
  }

  const config = {
    configurable: {
      thread_id: threadId || `thread-${Date.now()}`,
    },
  }

  return streamSSE(c, async (stream) => {
    const eventStream = agent.streamEvents(
      { messages: [{ role: "user", content: message }] },
      config
    )

    for await (const event of eventStream) {
      if (
        event.event === "on_chat_model_stream" &&
        event.data?.chunk?.content &&
        typeof event.data.chunk.content === "string"
      ) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "token",
            content: event.data.chunk.content,
          }),
        })
      }
    }

    await stream.writeSSE({
      data: JSON.stringify({ type: "done" }),
    })
  })
})

app.post("/api/chat/raw-stream", async (c) => {
  const body = await c.req.json()
  const { message, threadId } = body

  if (!message || typeof message !== "string") {
    return c.json({ error: "message is required (string)" }, 400)
  }

  const config = {
    configurable: {
      thread_id: threadId || `thread-${Date.now()}`,
    },
  }

  return streamSSE(c, async (stream) => {
    const eventStream = agent.streamEvents(
      { messages: [{ role: "user", content: message }] },
      config
    )

    for await (const event of eventStream) {
      await stream.writeSSE({
        event: event.event,
        data: JSON.stringify({
          ...event,
        }),
      })
    }

    await stream.writeSSE({
      event: "done",
      data: "{}",
    })
  })
})

const port = Number(process.env.PORT) || 3000
console.log(`Agent server running on http://localhost:${port}`)
console.log(`Working directory: ${WORK_DIR}`)

const server = serve({ fetch: app.fetch, port })

// graceful shutdown
process.on("SIGINT", () => {
  server.close()
  process.exit(0)
})
process.on("SIGTERM", () => {
  server.close((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }
    process.exit(0)
  })
})
