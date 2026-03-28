import type { Message, StreamEvent } from "../types"
import { agent, getSessionDir } from "../agent"
import {
  createMessage,
  getSessionMessages,
  getMessageById,
} from "./message-service"
import { updateSession } from "./session-service"
import { getSessionFiles, syncArtifacts } from "./artifact-service"
import { db } from "../db"
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

function toLangchainMessages(messages: Message[]) {
  return messages.map((msg) => {
    const content = msg.content || ""
    if (msg.role === "user") {
      return { role: "user" as const, content }
    }
    if (msg.role === "assistant") {
      return { role: "assistant" as const, content }
    }
    return { role: "user" as const, content }
  })
}

function detectNewArtifacts(sessionId: string) {
  const afterSnapshot = getSessionFiles(sessionId)
  return syncArtifacts(sessionId, afterSnapshot)
}

export async function chat(
  sessionId: string,
  userMessage: string
): Promise<{ content: string; message: Message }> {
  await createMessage(sessionId, "user", userMessage)

  const history = await getSessionMessages(sessionId)
  const langchainMessages = toLangchainMessages(history)

  const result = await agent.invoke(
    { messages: langchainMessages as any },
    { configurable: { thread_id: sessionId } }
  )

  const lastMessage = result.messages[result.messages.length - 1]
  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content)

  const savedMessage = await createMessage(sessionId, "assistant", content)

  await detectNewArtifacts(sessionId)
  await updateSession(sessionId, {})

  return { content, message: savedMessage }
}

export type StartStreamResult =
  | {
      ok: true
      streamId: string
      subscribe: (fn: (event: StreamEvent) => void) => () => void
    }
  | { ok: false; error: string; activeStreamId?: string }

export function startStream(
  sessionId: string,
  userMessage: string
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

  runAgentInBackground(sessionId, userMessage, task)

  return {
    ok: true,
    streamId,
    subscribe: (fn: (event: StreamEvent) => void) => {
      subscribe(streamId, fn)
      return () => unsubscribe(streamId, fn)
    },
  }
}

async function runAgentInBackground(
  sessionId: string,
  userMessage: string,
  task: ActiveTask
) {
  try {
    await createMessage(sessionId, "user", userMessage)

    await db.insert(streamTasks).values({
      id: task.id,
      sessionId,
      status: "streaming",
      content: "",
    })

    broadcast(task, { type: "stream_start", streamId: task.id })

    const history = await getSessionMessages(sessionId)
    const langchainMessages = toLangchainMessages(history)

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
      await db
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

      if (
        event.event === "on_chat_model_stream" &&
        event.data?.chunk?.content &&
        typeof event.data.chunk.content === "string"
      ) {
        fullContent += event.data.chunk.content
        tokenCount++

        task.content = fullContent
        broadcast(task, { type: "token", content: event.data.chunk.content })

        if (tokenCount % 10 === 0 || Date.now() - lastFlush > FLUSH_INTERVAL) {
          await flushToDb()
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
        broadcast(task, {
          type: "tool_end",
          name: event.name,
          output:
            typeof event.data?.output === "string"
              ? event.data.output.substring(0, 200)
              : JSON.stringify(event.data?.output).substring(0, 200),
        })
      }
    }

    if (task.abortController.signal.aborted) {
      await db
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
    await db
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

    await db
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
    await db
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
  const [row] = await db
    .select()
    .from(streamTasks)
    .where(eq(streamTasks.sessionId, sessionId))
    .orderBy(desc(streamTasks.createdAt))
    .limit(1)

  return row || null
}

export { getSessionDir }
