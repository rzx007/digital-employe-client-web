import {
  createIdGenerator,
  type ChatTransport,
  type FileUIPart,
  type UIMessage,
  type UIMessageChunk,
} from "ai"

import { request, getRequestHeaders } from "@/lib/request"
import {
  createLangChainStreamParseState,
  enqueueFinish,
  enqueueTextStart,
  enqueueTextEnd,
  parseLangChainPayloadToChunks,
} from "./langchain-stream-parser"

const generatePartId = createIdGenerator({
  prefix: "lc-part",
  size: 16,
})

function getEventBoundaryIndex(buffer: string) {
  const windowsBoundary = buffer.indexOf("\r\n\r\n")
  const unixBoundary = buffer.indexOf("\n\n")

  if (windowsBoundary === -1) {
    return unixBoundary
  }

  if (unixBoundary === -1) {
    return windowsBoundary
  }

  return Math.min(windowsBoundary, unixBoundary)
}

function getEventBoundaryLength(buffer: string, index: number) {
  return buffer.startsWith("\r\n\r\n", index) ? 4 : 2
}

function buildChatApiUrl(conversationId: string) {
  return `/digital/api/v1/text2sql/stream?id=${conversationId}`
}

function buildResumeApiUrl(conversationId: string) {
  return `/digital/api/v1/text2sql/stream/resume?id=${conversationId}`
}

function getConversationIdFromBody(body: object | undefined) {
  if (!body || typeof body !== "object") {
    return null
  }

  const { conversationId } = body as { conversationId?: unknown }

  return typeof conversationId === "string" ? conversationId : null
}

function getAttachmentsFromBody(body: object | undefined) {
  if (!body || typeof body !== "object") {
    return []
  }

  const { attachments } = body as { attachments?: unknown }

  return Array.isArray(attachments)
    ? (attachments.filter(
        (attachment): attachment is FileUIPart =>
          typeof attachment === "object" &&
          attachment !== null &&
          "type" in attachment &&
          attachment.type === "file"
      ) as FileUIPart[])
    : []
}

async function createEventSourceResponse(options: {
  conversationId: string
  prompt: string
  abortSignal: AbortSignal | undefined
}) {
  const response = await request.raw(buildChatApiUrl(options.conversationId), {
    method: "POST",
    headers: getRequestHeaders({
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ prompt: options.prompt }),
    signal: options.abortSignal,
  })

  if (!response.ok) {
    throw new Error(`聊天请求失败 (${response.status})`)
  }

  if (!response.body) {
    throw new Error("聊天响应为空")
  }

  return response.body
}

async function createResumeEventSourceResponse(options: {
  conversationId: string
  abortSignal: AbortSignal | undefined
}) {
  const response = await request.raw(
    buildResumeApiUrl(options.conversationId),
    {
      method: "GET",
      headers: getRequestHeaders({
        Accept: "text/event-stream",
      }),
      signal: options.abortSignal,
    }
  )

  if (response.status === 204) {
    return null
  }

  if (!response.ok) {
    throw new Error(`恢复聊天请求失败 (${response.status})`)
  }

  if (!response.body) {
    throw new Error("恢复聊天响应为空")
  }

  return response.body
}

export class LangChainChatTransport<
  UI_MESSAGE extends UIMessage,
> implements ChatTransport<UI_MESSAGE> {
  async sendMessages({
    messages,
    abortSignal,
    body,
  }: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0]) {
    const conversationId = getConversationIdFromBody(body)
    const attachments = getAttachmentsFromBody(body)
    const latestMessage = messages.at(-1)
    const latestText = latestMessage?.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()

    if (!conversationId) {
      throw new Error("缺少会话 ID")
    }

    if (!latestText) {
      throw new Error("消息内容不能为空")
    }

    void attachments

    const stream = await createEventSourceResponse({
      conversationId,
      prompt: latestText,
      abortSignal,
    })

    return this.processResponseStream(stream)
  }

  async reconnectToStream({
    chatId,
  }: Parameters<ChatTransport<UI_MESSAGE>["reconnectToStream"]>[0]) {
    if (!chatId) {
      return null
    }

    const stream = await createResumeEventSourceResponse({
      conversationId: chatId,
      abortSignal: undefined,
    })

    if (!stream) {
      return null
    }

    return this.processResponseStream(stream)
  }

  private processResponseStream(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder()
    const reader = stream.getReader()

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        const textId = generatePartId()
        let buffer = ""
        const state = createLangChainStreamParseState()

        controller.enqueue({ type: "start" })

        const flushEvent = (eventText: string) => {
          const lines = eventText
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())

          if (lines.length === 0) {
            return false
          }

          const data = lines.join("\n")

          if (data === "[DONE]") {
            enqueueTextEnd(controller, state, textId)
            enqueueFinish(controller, state)
            controller.close()
            return true
          }

          try {
            const payload = JSON.parse(data)
            const chunks = parseLangChainPayloadToChunks({
              payload,
              state,
              textId,
            })

            const hasTextDelta = chunks.some(
              (chunk) => chunk.type === "text-delta"
            )

            if (hasTextDelta) {
              enqueueTextStart(controller, state, textId)
            }

            chunks.forEach((chunk) => {
              controller.enqueue(chunk)
            })
          } catch {
            return false
          }

          return false
        }

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              break
            }

            buffer += decoder.decode(value, { stream: true })

            let separatorIndex = getEventBoundaryIndex(buffer)

            while (separatorIndex >= 0) {
              const eventText = buffer.slice(0, separatorIndex)
              buffer = buffer.slice(
                separatorIndex + getEventBoundaryLength(buffer, separatorIndex)
              )

              const didFinish = flushEvent(eventText)
              if (didFinish) {
                return
              }

              separatorIndex = getEventBoundaryIndex(buffer)
            }
          }

          if (buffer.trim()) {
            flushEvent(buffer)
          }

          enqueueTextEnd(controller, state, textId)
          enqueueFinish(controller, state)
          controller.close()
        } catch (error) {
          controller.enqueue({
            type: "error",
            errorText:
              error instanceof Error ? error.message : "流式响应解析失败",
          })
          controller.error(error)
        } finally {
          reader.releaseLock()
        }
      },
      cancel() {
        return reader.cancel()
      },
    })
  }
}
