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

export async function persistUserMessage(params: {
  conversationId: string
  contactId: string
  text: string
}) {
  await delay(MOCK_LATENCY_MS)

  const content = params.text.trim()

  if (!content) {
    throw new Error("消息内容不能为空")
  }

  const userMessage: Message = {
    id: `msg-${nanoid(10)}`,
    conversationId: params.conversationId,
    senderId: "user",
    senderName: "我",
    role: "user",
    content,
    timestamp: new Date(),
  }

  const nextMessages = messageStore[params.conversationId]
    ? [...messageStore[params.conversationId], userMessage]
    : [userMessage]

  messageStore[params.conversationId] = nextMessages

  const conversationIndex = conversationStore.findIndex(
    (conversation) => conversation.id === params.conversationId
  )

  if (conversationIndex >= 0) {
    const existingConversation = conversationStore[conversationIndex]
    const updatedConversation: Conversation = {
      ...existingConversation,
      title:
        existingConversation.title === "新对话"
          ? buildConversationTitle(content)
          : existingConversation.title,
      lastMessage: content,
      lastMessageTime: userMessage.timestamp,
      lastMessageType: "text",
      status: "running",
      unreadCount: 0,
      updatedAt: userMessage.timestamp,
    }

    conversationStore.splice(conversationIndex, 1)
    conversationStore.unshift(updatedConversation)
  }

  return userMessage
}

export async function persistAssistantMessage(params: {
  conversationId: string
  contactId: string
  text: string
}) {
  await delay(MOCK_LATENCY_MS)

  const content = params.text.trim()

  if (!content) {
    return null
  }

  const assistantMessage: Message = {
    id: `msg-${nanoid(10)}`,
    conversationId: params.conversationId,
    senderId: params.contactId,
    senderName: "AI 助手",
    role: "assistant",
    content,
    timestamp: new Date(),
  }

  const nextMessages = messageStore[params.conversationId]
    ? [...messageStore[params.conversationId], assistantMessage]
    : [assistantMessage]

  messageStore[params.conversationId] = nextMessages

  const conversationIndex = conversationStore.findIndex(
    (conversation) => conversation.id === params.conversationId
  )

  if (conversationIndex >= 0) {
    const existingConversation = conversationStore[conversationIndex]
    const updatedConversation: Conversation = {
      ...existingConversation,
      lastMessage: content,
      lastMessageTime: assistantMessage.timestamp,
      lastMessageType: "text",
      status: "idle",
      unreadCount: 0,
      updatedAt: assistantMessage.timestamp,
    }

    conversationStore.splice(conversationIndex, 1)
    conversationStore.unshift(updatedConversation)
  }

  return assistantMessage
}
