import type {
  AgentGroup,
  AgentMessage,
  Capability,
  MetadataSkill,
} from "@/api/types"
import { createDiceBearAvatar } from "@/lib/avatar"
import { fetchEmployees } from "@/api/employee"
import { createGroup as createGroupApi, fetchGroups } from "@/api/group"
import {
  fetchSessionMessages as fetchSessionMessagesApi,
  fetchSessions as fetchSessionsApi,
  createSession as createSessionApi,
} from "@/api/conversation"
import { type AIEmployee, type Contact } from "@/lib/mock-data/ai-employees"
import type { Conversation } from "@/lib/mock-data/conversations"
import type { Message } from "@/lib/mock-data/messages"

function parseJSON<T>(str: string | null, fallback: T): T {
  if (!str) return fallback
  try {
    return JSON.parse(str) as T
  } catch {
    return fallback
  }
}

function mapEmployeeToAIEmployee(emp: {
  id: string
  name: string
  description: string
  capabilities: string | null
  skills: string | null
}): AIEmployee {
  const capabilities = parseJSON<Capability[]>(emp.capabilities, [])
  const firstCap = capabilities[0]
  return {
    id: emp.id,
    name: emp.name,
    role: firstCap?.capability_desc ?? emp.description ?? "",
    avatar: createDiceBearAvatar(emp.id),
    status: "online",
    specialty: firstCap?.capability_desc ?? "",
    skills: parseJSON<MetadataSkill[]>(emp.skills, []),
  }
}

function getEmployeeIdFromContact(contact: Contact): string | null {
  if (contact.type === "employee") {
    return contact.employee?.id ?? null
  }
  return null
}

export async function fetchContacts(): Promise<Contact[]> {
  const [employees, groupsData] = await Promise.all([
    fetchEmployees(),
    fetchGroups(),
  ])

  const employeeList: Contact[] = employees.map((emp) => ({
    type: "employee" as const,
    employee: mapEmployeeToAIEmployee(emp),
  }))

  const allEmployees: AIEmployee[] = employees.map(mapEmployeeToAIEmployee)

  const groupContacts: Contact[] = groupsData.map((group) => {
    const ids = parseJSON<string[]>(group.employeeIds, [])
    return {
      type: "group" as const,
      group: {
        id: group.id,
        name: group.name,
        participants: ids
          .map((eid) => allEmployees.find((e) => e.id === eid))
          .filter(Boolean) as AIEmployee[],
      },
    }
  })

  return [...employeeList, ...groupContacts]
}

export async function createContactGroup(params: {
  name: string
  employeeIds: string[]
}): Promise<AgentGroup> {
  return createGroupApi({
    name: params.name,
    employeeIds: params.employeeIds,
  })
}

export async function fetchConversationsByContactId(
  contactId: string,
  contact?: Contact
): Promise<Conversation[]> {
  if (!contact || contact.type === "curator") {
    return []
  }

  const employeeId = getEmployeeIdFromContact(contact)
  if (!employeeId) return []

  const items = await fetchSessionsApi(employeeId)

  return items.map((session) => ({
    id: session.id,
    title: session.title,
    contactId,
    unreadCount: 0,
    updatedAt: new Date(session.updatedAt),
  }))
}

export async function fetchMessagesByConversationId(
  conversationId: string | number
): Promise<Message[]> {
  const items = await fetchSessionMessagesApi(String(conversationId))

  return items
    .filter(
      (msg: AgentMessage) => msg.role === "user" || msg.role === "assistant"
    )
    .map((msg: AgentMessage) => ({
      id: String(msg.id),
      conversationId: msg.sessionId,
      senderId: msg.role === "user" ? "user" : "",
      senderName: msg.role === "user" ? "我" : "",
      role: msg.role as Message["role"],
      content: msg.content ?? "",
      timestamp: new Date(msg.createdAt),
      parts: msg.parts ?? undefined,
    }))
}

export async function createConversation(params: {
  contactId: string
  title?: string
  contact?: Contact
}): Promise<Conversation> {
  if (!params.contact || params.contact.type === "curator") {
    return {
      id: `draft-${params.contactId}-${Date.now()}`,
      title: params.title ?? "新对话",
      contactId: params.contactId,
      updatedAt: new Date(),
      unreadCount: 0,
    }
  }

  const employeeId = getEmployeeIdFromContact(params.contact)
  const session = await createSessionApi(
    params.title ?? "新对话",
    employeeId ?? undefined
  )

  return {
    id: session.id,
    title: session.title,
    contactId: params.contactId,
    unreadCount: 0,
    updatedAt: new Date(session.updatedAt),
  }
}
