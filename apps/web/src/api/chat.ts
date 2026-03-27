import { nanoid } from "nanoid"

import type { Employee, Group as ApiGroup } from "@/api/types"
import { fetchEmployees } from "@/api/employee"
import { createGroup as createGroupApi, fetchGroups } from "@/api/group"
import {
  PRIMARY_CURATOR,
  type AIEmployee,
  type Contact,
} from "@/lib/mock-data/ai-employees"
import { CONVERSATIONS } from "@/lib/mock-data/conversations"
import type { Conversation } from "@/lib/mock-data/conversations"
import { MOCK_MESSAGES } from "@/lib/mock-data/messages"
import type { Message } from "@/lib/mock-data/messages"

const MOCK_LATENCY_MS = 280
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

function mapStatus(status: number): AIEmployee["status"] {
  if (status === 1) return "online"
  return "offline"
}

function mapEmployeeToAIEmployee(emp: Employee): AIEmployee {
  return {
    id: String(emp.id),
    name: emp.name,
    role: emp.metadata?.capability_desc ?? emp.employee_code,
    avatar: `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(emp.id)}`,
    status: mapStatus(emp.metadata?.status ?? 0),
    specialty: emp.metadata?.capability_desc ?? "",
  }
}

export async function fetchContacts(): Promise<Contact[]> {
  const [employeesRes, groupsRes] = await Promise.all([
    fetchEmployees(),
    fetchGroups(),
  ])

  const employees: Contact[] = (employeesRes?.data ?? []).map((emp) => ({
    type: "employee" as const,
    employee: mapEmployeeToAIEmployee(emp),
  }))

  const allEmployees: AIEmployee[] = (employeesRes?.data ?? []).map(
    mapEmployeeToAIEmployee
  )

  const groups: Contact[] = (groupsRes?.data ?? []).map((group: ApiGroup) => ({
    type: "group" as const,
    group: {
      id: String(group.id),
      name: group.name,
      participants: (group.employee_ids ?? [])
        .map((eid) => allEmployees.find((e) => e.id === String(eid)))
        .filter(Boolean) as AIEmployee[],
    },
  }))

  return [
    { type: "curator" as const, curator: PRIMARY_CURATOR },
    ...employees,
    ...groups,
  ]
}

export async function createContactGroup(params: {
  name: string
  employeeIds: number[]
}): Promise<ApiGroup> {
  const res = await createGroupApi({
    name: params.name,
    employee_ids: params.employeeIds,
  })
  return res.data ?? ({} as ApiGroup)
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
