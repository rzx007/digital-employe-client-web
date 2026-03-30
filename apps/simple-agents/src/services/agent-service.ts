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
  type UIMessageChunk,
} from "ai"
import * as fs from "node:fs"
import * as path from "node:path"

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

const FILE_OPERATION_TOOLS = new Set(["write_file", "edit_file", "read_file"])

function isFileOperationTool(toolName: string): boolean {
  return FILE_OPERATION_TOOLS.has(toolName)
}

function inferArtifactType(filePath: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filePath)
  const ext = match?.[1]?.toLowerCase()
  if (!ext) return "text"
  if (
    ["ts", "tsx", "js", "jsx", "json", "py", "sql", "css", "html"].includes(ext)
  )
    return "code"
  if (ext === "csv") return "sheet"
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image"
  return "text"
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


/**
uiStream (ReadableStream<UIMessageChunk>)
     ↓ pipeThrough
TransformStream
  transform(chunk, controller):
    1. 检测到文件工具 input → 缓存到 Map
    2. 检测到文件工具 output → readFileSync → controller.enqueue(data-artifact)
    3. controller.enqueue(chunk)  ← 透传原始 chunk
     ↓ pipeThrough 输出
增强后的 ReadableStream<UIMessageChunk>（原始 chunk + 注入的 data-artifact 交替）
     ↓ writer.merge()
writer → SSE 响应 → 前端
 */

export async function chatStreamResponse(
  sessionId: string,
  messages: UIMessage[],
  employeeId?: string
): Promise<Response> {
  // 保存用户消息到 DB
  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.role === "user") {
    const userText = lastMessage.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim()
    await createMessage(sessionId, "user", userText || "", {
      parts: lastMessage.parts,
    })
  }
  const agent = await resolveAgent(employeeId)

  const config = { configurable: { thread_id: sessionId } }
  const langchainMessages = await toBaseMessages(messages)

  const graphStream = await agent.stream(
    { messages: langchainMessages },
    { ...config, streamMode: ["messages", "values"] }
  )

  const uiStream = toUIMessageStream(graphStream)

  const managedStream = createUIMessageStream({
    execute({ writer }) {
      const sessionDir = getSessionDir(sessionId)
      const pendingFileTools = new Map<
        string,
        { toolName: string; input: any }
      >()

      const enhancedStream = new TransformStream<
        UIMessageChunk,
        UIMessageChunk
      >({
        transform(chunk, controller) {
          if (
            chunk.type === "tool-input-available" &&
            "dynamic" in chunk &&
            chunk.dynamic === true &&
            "toolName" in chunk
          ) {
            const { toolName, input } = chunk as any
            if (isFileOperationTool(toolName)) {
              pendingFileTools.set(chunk.toolCallId, {
                toolName,
                input,
              })
            }
          }

          if (chunk.type === "tool-output-available") {
            const pending = pendingFileTools.get(chunk.toolCallId)
            if (pending) {
              const filePath = pending.input?.file_path
              if (typeof filePath === "string") {
                try {
                  const content = fs.readFileSync(
                    path.join(sessionDir, filePath),
                    "utf-8"
                  )
                  controller.enqueue({
                    type: "data-artifact",
                    id: `artifact:${chunk.toolCallId}`,
                    data: {
                      id: `artifact:${chunk.toolCallId}`,
                      type: inferArtifactType(filePath),
                      title: path.basename(filePath),
                      content,
                      filePath,
                      toolName: pending.toolName,
                    },
                  } as any)
                } catch {
                  // file write may have failed, ignore
                }
              }
              pendingFileTools.delete(chunk.toolCallId)
            }
          }

          controller.enqueue(chunk)
        },
      })

      writer.merge(uiStream.pipeThrough(enhancedStream))
    },
    onFinish: async ({ responseMessage }) => {
      await persistAssistantMessage(sessionId, responseMessage)
    },
  })

  return createUIMessageStreamResponse({ stream: managedStream })
}

export { getSessionDir }
