import {
  createIdGenerator,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai"

const SIMPLE_AGENTS_BASE = import.meta.env.DEV
  ? "/simple-agents/api/sessions"
  : "http://localhost:3005/api/sessions"

function buildRawStreamUrl(conversationId: string) {
  return `${SIMPLE_AGENTS_BASE}/${conversationId}/chat/raw-stream`
}

function buildResumeUrl(conversationId: string) {
  return `${SIMPLE_AGENTS_BASE}/${conversationId}/chat/raw-stream/resume`
}

const generatePartId = createIdGenerator({
  prefix: "sa-part",
  size: 16,
})

function getEventBoundaryIndex(buffer: string) {
  const windowsBoundary = buffer.indexOf("\r\n\r\n")
  const unixBoundary = buffer.indexOf("\n\n")
  if (windowsBoundary === -1) return unixBoundary
  if (unixBoundary === -1) return windowsBoundary
  return Math.min(windowsBoundary, unixBoundary)
}

function getEventBoundaryLength(buffer: string, index: number) {
  return buffer.startsWith("\r\n\r\n", index) ? 4 : 2
}

interface ToolCallTracker {
  id: string
  name: string
  argsText: string
  sentInputStart: boolean
  sentInputAvailable: boolean
}

export class SimpleAgentsTransport<
  UI_MESSAGE extends UIMessage,
> implements ChatTransport<UI_MESSAGE> {
  private _skill: string | undefined

  setSkill(skill: string | undefined) {
    this._skill = skill
  }

  async sendMessages({
    chatId,
    messages,
    abortSignal,
  }: Parameters<ChatTransport<UI_MESSAGE>["sendMessages"]>[0]) {
    const decisions = extractResumeDecisions(messages)

    let url: string
    let body: any

    if (decisions && Object.keys(decisions).length > 0) {
      url = buildResumeUrl(chatId)
      body = { resumeDecisions: decisions }
    } else {
      const lastUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === "user")
      const text =
        lastUserMsg?.parts
          ?.filter((p) => p.type === "text")
          .map((p) => (p as any).text)
          .join("\n")
          .trim() ?? ""

      if (!text) {
        throw new Error("Message content is empty")
      }

      url = buildRawStreamUrl(chatId)
      body = { message: text }
      if (this._skill) {
        body.skill = this._skill
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      throw new Error(
        errorData?.error || `Stream request failed (${response.status})`
      )
    }

    const isResume = !!(decisions && Object.keys(decisions).length > 0)

    if (!response.body) {
      throw new Error("Stream response body is empty")
    }

    return this.processResponseStream(response.body, isResume)
  }

  async reconnectToStream() {
    return null
  }

  private processResponseStream(stream: ReadableStream<Uint8Array>, isResume: boolean) {
    const decoder = new TextDecoder()
    const reader = stream.getReader()

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        const toolCallTrackers = new Map<string, ToolCallTracker>()
        const currentTracker = { value: null as ToolCallTracker | null }
        let currentTextId: string | null = null
        let buffer = ""

        controller.enqueue({ type: "start" })

        function ensureTextId() {
          if (!currentTextId) {
            currentTextId = generatePartId()
            controller.enqueue({ type: "text-start", id: currentTextId })
          }
          return currentTextId
        }

        function closeText() {
          if (currentTextId) {
            controller.enqueue({ type: "text-end", id: currentTextId })
            currentTextId = null
          }
        }

        function flush() {
          controller.enqueue({ type: "finish", finishReason: "stop" })
          controller.close()
        }

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })

            let separatorIndex = getEventBoundaryIndex(buffer)

            while (separatorIndex >= 0) {
              const eventText = buffer.slice(0, separatorIndex)
              buffer = buffer.slice(
                separatorIndex + getEventBoundaryLength(buffer, separatorIndex)
              )

              const shouldStop = processSSEEvent(
                eventText,
                controller,
                toolCallTrackers,
                currentTracker,
                ensureTextId,
                closeText,
                flush,
                isResume
              )
              if (shouldStop) return

              separatorIndex = getEventBoundaryIndex(buffer)
            }
          }

          closeText()
          flush()
        } catch (error) {
          controller.enqueue({
            type: "error",
            errorText:
              error instanceof Error
                ? error.message
                : "Stream parsing failed",
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

function processSSEEvent(
  eventText: string,
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  toolCallTrackers: Map<string, ToolCallTracker>,
  currentTracker: { value: ToolCallTracker | null },
  ensureTextId: () => string,
  closeText: () => void,
  flush: () => void,
  isResume: boolean
): boolean {
  const lines = eventText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())

  if (lines.length === 0) return false

  const data = lines.join("\n")

  if (data === "[DONE]") {
    closeText()
    flush()
    return true
  }

  let payload: any
  try {
    payload = JSON.parse(data)
  } catch {
    return false
  }

  if (!payload || typeof payload.type !== "string") {
    return false
  }

  switch (payload.type) {
    case "stream_start":
      return false

    case "messages": {
      const { chunk, metadata } = payload
      const textContent =
        typeof chunk?.content === "string" ? chunk.content : ""

      if (textContent) {
        const textId = ensureTextId()
        controller.enqueue({
          type: "text-delta",
          id: textId,
          delta: textContent,
        })
      }

      // tool_call_chunks — 流式工具调用参数
      // 根据 LangChain 官方 issue #8394:
      // - 第一个 chunk 有 id + name + args(可能为空)
      // - 后续碎片 chunk 只有 args，没有 id 和 name
      // - 所有 tool_call_chunks 的 index 都是 0（不能用 index 区分）
      if (Array.isArray(chunk?.tool_call_chunks) && chunk.tool_call_chunks.length > 0) {
        closeText()
        for (const tc of chunk.tool_call_chunks) {
          let tracker: ToolCallTracker | undefined

          if (tc.id) {
            // 新工具调用（有 id）—— 创建或查找 tracker
            tracker = toolCallTrackers.get(tc.id)
            if (!tracker) {
              tracker = {
                id: tc.id,
                name: tc.name || "unknown_tool",
                argsText: "",
                sentInputStart: false,
                sentInputAvailable: false,
              }
              toolCallTrackers.set(tc.id, tracker)
            }
            currentTracker.value = tracker
          } else if (currentTracker.value) {
            // 当前工具调用的后续 args 碎片（无 id）—— 复用 currentTracker
            tracker = currentTracker.value
          } else {
            continue
          }

          if (!tracker.sentInputStart) {
            controller.enqueue({
              type: "tool-input-start",
              toolCallId: tracker.id,
              toolName: tracker.name,
            })
            tracker.sentInputStart = true
          }

          if (tc.args) {
            tracker.argsText += tc.args
            controller.enqueue({
              type: "tool-input-delta",
              toolCallId: tracker.id,
              inputTextDelta: tc.args,
            })

            if (!tracker.sentInputAvailable) {
              try {
                const parsed = JSON.parse(tracker.argsText)
                controller.enqueue({
                  type: "tool-input-available",
                  toolCallId: tracker.id,
                  toolName: tracker.name,
                  input: parsed,
                })
                tracker.sentInputAvailable = true
              } catch {
                // args 还不完整，等下次
              }
            }
          }
        }
      }

      return false
    }

    case "updates": {
      const data = payload.data
      if (!data || typeof data !== "object") return false

      // 工具执行结果 — updates 中包含 tools 节点的 ToolMessage
      // resume 流中跳过，避免 AI SDK 找不到旧 step 中的 tool part
      if (data.tools && Array.isArray(data.tools.messages) && !isResume) {
        closeText()
        for (const msg of data.tools.messages) {
          // LangChain 序列化格式: {lc:1, type:"constructor", kwargs:{type:"ToolMessage", tool_call_id:"...", ...}}
          const kwargs = msg?.kwargs || msg
          const toolCallId = kwargs.tool_call_id || msg.tool_call_id

          if (toolCallId) {
            const toolName = kwargs.name || msg.name || null
            const content = kwargs.content ?? msg.content
            const outputText =
              typeof content === "string"
                ? content
                : content != null
                  ? JSON.stringify(content)
                  : ""

            controller.enqueue({
              type: "tool-output-available",
              toolCallId,
              output: {
                status: kwargs.status || msg.status || "success",
                text: outputText,
                toolName,
              },
            })
          }
        }
      }

      return false
    }

    case "interrupt": {
      closeText()

      const interrupts = Array.isArray(payload.interrupts)
        ? payload.interrupts
        : []

      for (const interrupt of interrupts) {
        const value = interrupt?.value || {}
        const actionRequests = Array.isArray(value.actionRequests)
          ? value.actionRequests
          : []

        const matchedTrackerIds = new Set<string>()

        for (const action of actionRequests) {
          const actionArgsKey = JSON.stringify(action.args)

          let existingToolCallId: string | undefined
          for (const [, tracker] of toolCallTrackers) {
            if (tracker.name !== action.name || !tracker.id) continue
            if (matchedTrackerIds.has(tracker.id)) continue

            let trackerArgsKey: string
            try {
              trackerArgsKey = JSON.stringify(JSON.parse(tracker.argsText))
            } catch {
              continue
            }

            if (trackerArgsKey === actionArgsKey) {
              existingToolCallId = tracker.id
              matchedTrackerIds.add(tracker.id)
              break
            }
          }

          if (existingToolCallId) {
            controller.enqueue({
              type: "tool-approval-request",
              toolCallId: existingToolCallId,
              approvalId: existingToolCallId,
            })
          } else {
            const toolCallId = `hitl-${action.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

            controller.enqueue({
              type: "tool-input-start",
              toolCallId,
              toolName: action.name,
              dynamic: true,
            })

            controller.enqueue({
              type: "tool-input-available",
              toolCallId,
              toolName: action.name,
              input: action.args || {},
              dynamic: true,
            })

            controller.enqueue({
              type: "tool-approval-request",
              toolCallId,
              approvalId: toolCallId,
            })
          }
        }
      }

      flush()
      return true
    }

    case "done":
      closeText()
      flush()
      return true

    case "error":
      closeText()
      controller.enqueue({
        type: "error",
        errorText: payload.message || "Stream error",
      })
      flush()
      return true

    case "cancelled":
      closeText()
      flush()
      return true

    default:
      return false
  }
}

function extractResumeDecisions(
  messages: UIMessage[]
): Record<string, { type: string; args?: Record<string, unknown> }> | null {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
  if (!lastAssistant) return null

  const hasApproval = lastAssistant.parts.some(
    (p) => (p as any).state === "approval-responded"
  )
  if (!hasApproval) return null

  const decisions: Record<string, { type: string; args?: Record<string, unknown> }> =
    {}

  for (const part of lastAssistant.parts) {
    if (
      (part as any).state === "approval-responded" &&
      part.toolCallId &&
      (part as any).approval
    ) {
      const approval = (part as any).approval
      decisions[part.toolCallId] = {
        type: approval.approved ? "approve" : "reject",
        args: approval.args,
      }
    }
  }

  return Object.keys(decisions).length > 0 ? decisions : null
}
