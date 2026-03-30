import type { Message } from "../types"
import { getSessionDir } from "../agent"
import { createMessage, getSessionMessages } from "./message-service"
import { updateSession } from "./session-service"
import { getSessionFiles, syncArtifacts } from "./artifact-service"
import { getEmployee } from "./employee-service"

export function applySkillHint(message: string, skill?: string): string {
  if (!skill) return message
  return `[当前指定技能: ${skill}] ${message}`
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

  const { getAgent } = await import("../agent")
  return getAgent(cacheKey, systemPrompt)
}

export async function chat(
  sessionId: string,
  userMessage: string,
  employeeId?: string,
  skill?: string
): Promise<{ content: string; message: Message }> {
  await createMessage(sessionId, "user", userMessage)

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

export { getSessionDir }
