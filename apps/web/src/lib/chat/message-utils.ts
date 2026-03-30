import type { UIMessage } from "ai"

import type { Artifact } from "@/types/artifact"
import type { Message } from "@/lib/mock-data/messages"

type ToolRenderPart = Extract<
  UIMessage["parts"][number],
  {
    type: `tool-${string}` | "dynamic-tool"
    toolCallId: string
  }
>

export type MessageRenderBlock =
  | {
      kind: "text"
      key: string
      text: string
    }
  | {
      kind: "artifact"
      key: string
      artifact: Artifact
    }
  | {
      kind: "tool"
      key: string
      part: ToolRenderPart
    }

function isToolRenderPart(
  part: UIMessage["parts"][number]
): part is ToolRenderPart {
  return (
    "toolCallId" in part &&
    (part.type.startsWith("tool-") || part.type === "dynamic-tool")
  )
}

function isDataArtifactPart(
  part: UIMessage["parts"][number]
): part is { type: `data-artifact`; id: string; data: Artifact } {
  return part.type === "data-artifact" && "data" in part && part.data != null
}

export function getTextFromUIMessage(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

export function getRenderBlocksFromUIMessage(
  message: UIMessage
): MessageRenderBlock[] {
  return message.parts.reduce<MessageRenderBlock[]>((blocks, part, index) => {
    if (part.type === "text") {
      if (part.text) {
        blocks.push({
          kind: "text",
          key: `${message.id}:text:${index}`,
          text: part.text,
        })
      }

      return blocks
    }

    if (isDataArtifactPart(part)) {
      blocks.push({
        kind: "artifact",
        key: `${message.id}:artifact:${part.data.id}:${index}`,
        artifact: part.data,
      })

      return blocks
    }

    if (isToolRenderPart(part)) {
      blocks.push({
        kind: "tool",
        key: `${message.id}:tool:${part.toolCallId}:${index}`,
        part,
      })
    }

    return blocks
  }, [])
}

export function getLatestArtifactFromUIMessage(
  message: UIMessage
): Artifact | null {
  for (let i = message.parts.length - 1; i >= 0; i--) {
    const part = message.parts[i]
    if (isDataArtifactPart(part)) {
      return part.data
    }
  }
  return null
}

export function mapStoredMessagesToUIMessages(
  messages: Message[]
): UIMessage[] {
  return messages.map((message) => {
    if (message.parts) {
      try {
        const parts = JSON.parse(message.parts) as UIMessage["parts"]
        if (Array.isArray(parts) && parts.length > 0) {
          return {
            id: message.id,
            role: message.role,
            parts,
          }
        }
      } catch {
        // fall through to content fallback
      }
    }

    if (message.chunkJson) {
      try {
        const parts = JSON.parse(message.chunkJson) as UIMessage["parts"]
        if (Array.isArray(parts) && parts.length > 0) {
          return {
            id: message.id,
            role: message.role,
            parts,
          }
        }
      } catch {
        // fall through to content fallback
      }
    }

    return {
      id: message.id,
      role: message.role,
      parts: [
        {
          type: "text",
          text: message.content,
          state: "done",
        },
      ],
    }
  })
}
