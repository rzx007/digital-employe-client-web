import { type ChatTransport, type UIMessage, type UIMessageChunk } from "ai"

const SIMPLE_AGENTS_BASE = "/simple-agents"

export class SimpleAgentsChatTransport<
  UI_MESSAGE extends UIMessage,
> implements ChatTransport<UI_MESSAGE> {
  async sendMessages({
    messages,
    abortSignal,
    body,
  }: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0]) {
    const sessionId = getSessionIdFromBody(body)
    const latestMessage = messages.at(-1)
    const latestText = latestMessage?.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()

    if (!sessionId) {
      throw new Error("缺少会话 ID")
    }

    if (!latestText) {
      throw new Error("消息内容不能为空")
    }

    const response = await fetch(
      `${SIMPLE_AGENTS_BASE}/api/sessions/${sessionId}/chat/stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: latestText }),
        signal: abortSignal,
      }
    )

    if (!response.ok) {
      throw new Error(`聊天请求失败 (${response.status})`)
    }

    if (!response.body) {
      throw new Error("聊天响应为空")
    }

    return this.processResponseStream(response.body)
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  private processResponseStream(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder()
    const reader = stream.getReader()

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        let buffer = ""

        controller.enqueue({ type: "start" })

        const flushEvent = (eventText: string) => {
          const lines = eventText
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())

          if (lines.length === 0) return false

          const data = lines.join("\n")

          if (data === "[DONE]") {
            controller.enqueue({ type: "finish", finishReason: "stop" })
            controller.close()
            return true
          }

          try {
            const chunk = JSON.parse(data) as UIMessageChunk
            controller.enqueue(chunk)
          } catch {
            return false
          }

          return false
        }

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })

            let sepIndex = buffer.indexOf("\n\n")

            if (sepIndex === -1) {
              sepIndex = buffer.indexOf("\r\n\r\n")
            }

            while (sepIndex >= 0) {
              const sepLen = buffer.startsWith("\r\n\r\n", sepIndex) ? 4 : 2
              const eventText = buffer.slice(0, sepIndex)
              buffer = buffer.slice(sepIndex + sepLen)

              const didFinish = flushEvent(eventText)
              if (didFinish) return

              sepIndex = buffer.indexOf("\n\n")
              if (sepIndex === -1) {
                sepIndex = buffer.indexOf("\r\n\r\n")
              }
            }
          }

          if (buffer.trim()) {
            flushEvent(buffer)
          }

          controller.enqueue({ type: "finish", finishReason: "stop" })
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

function getSessionIdFromBody(body: object | undefined) {
  if (!body || typeof body !== "object") return null

  const { conversationId } = body as { conversationId?: unknown }

  return typeof conversationId === "string" ? conversationId : null
}
