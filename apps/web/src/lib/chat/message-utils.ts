import type { UIMessage } from "ai"

import type { Artifact } from "@/types/artifact"
import type { Message } from "@/lib/mock-data/messages"

export {
  getArtifactFromToolPart,
  getArtifactsFromUIMessage,
  getLatestArtifactFromUIMessage,
} from "./artifact-utils"

import { getArtifactFromToolPart } from "./artifact-utils"

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

    const artifact = getArtifactFromToolPart(part)

    if (artifact) {
      blocks.push({
        kind: "artifact",
        key: `${message.id}:artifact:${artifact.id}:${index}`,
        artifact,
      })
    }

    return blocks
  }, [])
}

export function mapStoredMessagesToUIMessages(
  messages: Message[]
): UIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [
      {
        type: "text",
        text: message.content,
        state: "done",
      },
    ],
  }))
}
