import type { Message } from "../types"
import { getAgent, getSessionDir } from "../agent"
import { createMessage, getSessionMessages } from "./message-service"
import { updateSession } from "./session-service"
import { getSessionFiles, syncArtifacts } from "./artifact-service"
import { getEmployee } from "./employee-service"
import { toBaseMessages, toUIMessageStream } from "@ai-sdk/langchain"
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai"

function parseMessagePartsToUIMessages(messages: Message[]): UIMessage[] {
  return messages.map((msg) => {
    if (msg.parts) {
      try {
        const parts = JSON.parse(msg.parts)
        if (Array.isArray(parts) && parts.length > 0) {
          return {
            id: String(msg.id),
            role: msg.role as UIMessage["role"],
            parts,
            createdAt: msg.createdAt,
          }
        }
      } catch {
        // fall through
      }
    }

    return {
      id: String(msg.id),
      role: msg.role as UIMessage["role"],
      parts: [{ type: "text" as const, text: msg.content || "" }],
      createdAt: msg.createdAt,
    }
  })
}

export function toLangchainMessages(messages: Message[]) {
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

export function detectNewArtifacts(sessionId: string) {
  const afterSnapshot = getSessionFiles(sessionId)
  return syncArtifacts(sessionId, afterSnapshot)
}

async function resolveAgent(employeeId?: string) {
  const cacheKey = employeeId || "__default__"
  let systemPrompt: string | undefined

  if (employeeId) {
    const emp = await getEmployee(employeeId)
    systemPrompt = emp?.systemPrompt || undefined
  }

  return getAgent(cacheKey, systemPrompt)
}

export async function chat(
  sessionId: string,
  userMessage: string,
  employeeId?: string
): Promise<{ content: string; message: Message }> {
  await createMessage(sessionId, "user", userMessage)

  const history = await getSessionMessages(sessionId)
  const langchainMessages = toLangchainMessages(history)

  const agent = await resolveAgent(employeeId)

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

async function persistAssistantMessage(
  sessionId: string,
  responseMessage: UIMessage
) {
  const fullContent = responseMessage.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")

  await createMessage(sessionId, "assistant", fullContent, {
    parts: responseMessage.parts,
  })

  await detectNewArtifacts(sessionId)
  await updateSession(sessionId, {})
}

export async function chatStreamResponse(
  sessionId: string,
  userMessage: string,
  employeeId?: string
): Promise<Response> {
  await createMessage(sessionId, "user", userMessage, {
    parts: [{ type: "text", text: userMessage }],
  })

  const agent = await resolveAgent(employeeId)

  const config = { configurable: { thread_id: sessionId } }
  const history = await getSessionMessages(sessionId)
  // const uiMessages = parseMessagePartsToUIMessages(history)
  // const langchainMessages = await toBaseMessages(uiMessages)
  const langchainMessages = toLangchainMessages(history)
  const graphStream = await agent.stream(
    { messages: langchainMessages },
    { ...config, streamMode: ["messages", "values"] }
  )

  const uiStream = toUIMessageStream(graphStream)

  const managedStream = createUIMessageStream({
    execute({ writer }) {
      writer.merge(uiStream)
    },
    onFinish: async ({ responseMessage }) => {
      await persistAssistantMessage(sessionId, responseMessage)
    },
  })

  return createUIMessageStreamResponse({ stream: managedStream })
}

export { getSessionDir }
