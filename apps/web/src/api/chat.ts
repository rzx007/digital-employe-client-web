import { nanoid } from "nanoid"

import { CONTACTS } from "@/lib/mock-data/ai-employees"
import type { Contact } from "@/lib/mock-data/ai-employees"
import { CONVERSATIONS } from "@/lib/mock-data/conversations"
import type { Conversation } from "@/lib/mock-data/conversations"
import { MOCK_MESSAGES } from "@/lib/mock-data/messages"
import type { Message } from "@/lib/mock-data/messages"

const MOCK_LATENCY_MS = 280
const contactStore = [...CONTACTS]
const conversationStore = [...CONVERSATIONS]
const messageStore = Object.fromEntries(
  Object.entries(MOCK_MESSAGES).map(([conversationId, messages]) => [
    conversationId,
    [...messages],
  ])
) as Record<string, Message[]>

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildConversationTitle(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim()

  if (!normalized) {
    return "新对话"
  }

  return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized
}

/** 占位：日后替换为真实 HTTP 请求 */
export async function fetchContacts(): Promise<Contact[]> {
  await delay(MOCK_LATENCY_MS)
  return [...contactStore]
}

export async function fetchConversationsByContactId(
  contactId: string
): Promise<Conversation[]> {
  await delay(MOCK_LATENCY_MS)
  return conversationStore.filter(
    (conversation) => conversation.contactId === contactId
  )
}

export async function fetchMessagesByConversationId(
  conversationId: string
): Promise<Message[]> {
  await delay(MOCK_LATENCY_MS)
  const list = messageStore[conversationId]
  return list ? [...list] : []
}

export async function createConversation(params: {
  contactId: string
  title?: string
}): Promise<Conversation> {
  await delay(MOCK_LATENCY_MS)

  const conversation: Conversation = {
    id: `conv-${nanoid(8)}`,
    title: buildConversationTitle(params.title ?? ""),
    contactId: params.contactId,
    status: "running",
    unreadCount: 0,
    updatedAt: new Date(),
  }

  conversationStore.unshift(conversation)
  messageStore[conversation.id] = []

  return { ...conversation }
}
