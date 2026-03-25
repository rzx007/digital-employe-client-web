import type { UIMessage } from "ai"
import type { Message } from "@/lib/mock-data/messages"

export function getTextFromUIMessage(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
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
