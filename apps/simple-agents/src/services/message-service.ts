import type { Message } from "../types"
import { db } from "../db"
import { messages } from "../db/schema"
import { eq, asc, sql, and, gt } from "drizzle-orm"

export async function createMessage(
  sessionId: string,
  role: Message["role"],
  content: string | null,
  options?: {
    toolCalls?: unknown
    toolResults?: unknown
    tokenCount?: number
  }
): Promise<Message> {
  const [msg] = await db
    .insert(messages)
    .values({
      sessionId,
      role,
      content,
      toolCalls: options?.toolCalls ? JSON.stringify(options.toolCalls) : null,
      toolResults: options?.toolResults
        ? JSON.stringify(options.toolResults)
        : null,
      tokenCount: options?.tokenCount,
    })
    .returning()

  return msg
}

export async function getMessages(
  sessionId: string,
  page = 1,
  pageSize = 50,
  before?: number
) {
  const conditions = [eq(messages.sessionId, sessionId)]
  if (before !== undefined) {
    conditions.push(gt(messages.id, before))
  }

  const where = and(...conditions)

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(where)

  const data = await db
    .select()
    .from(messages)
    .where(where)
    .orderBy(asc(messages.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    data,
    total: Number(count),
    page,
    pageSize,
    totalPages: Math.ceil(Number(count) / pageSize),
  }
}

export async function getSessionMessages(
  sessionId: string
): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.id))
}

export async function getLatestMessages(
  sessionId: string,
  limit = 20
): Promise<Message[]> {
  const all = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.id))

  return all.slice(-limit)
}

export async function getMessageCount(sessionId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))

  return Number(count)
}

export async function getMessageById(id: number): Promise<Message | null> {
  const [msg] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, id))
    .limit(1)

  return msg || null
}

export async function deleteSessionMessages(sessionId: string): Promise<void> {
  await db.delete(messages).where(eq(messages.sessionId, sessionId))
}
