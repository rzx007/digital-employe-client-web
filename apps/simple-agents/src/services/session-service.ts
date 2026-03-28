import type { CreateSessionInput, UpdateSessionInput, Session } from "../types"
import { db, DATA_DIR } from "../db"
import { sessions } from "../db/schema"
import { eq, desc, sql, and } from "drizzle-orm"
import { nanoid } from "nanoid"
import path from "node:path"
import fs from "node:fs"

export async function createSession(
  input: CreateSessionInput = {}
): Promise<Session> {
  const id = input.id || nanoid()
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null

  const [session] = await db
    .insert(sessions)
    .values({ id, title: input.title || "新会话", metadata })
    .returning()

  const sessionDir = path.join(DATA_DIR, "workspace", id)
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
  }

  return session
}

export async function getSession(id: string): Promise<Session | null> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)
  return session || null
}

export async function listSessions(
  page = 1,
  pageSize = 20,
  includeArchived = false
) {
  const where = includeArchived
    ? undefined
    : and(eq(sessions.isArchived, false))

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sessions)
    .where(where)

  const data = await db
    .select()
    .from(sessions)
    .where(where)
    .orderBy(desc(sessions.updatedAt))
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

export async function updateSession(
  id: string,
  input: UpdateSessionInput
): Promise<Session | null> {
  const values: Record<string, unknown> = { updatedAt: sql`datetime('now')` }
  if (input.title !== undefined) values.title = input.title
  if (input.metadata !== undefined)
    values.metadata = JSON.stringify(input.metadata)
  if (input.isArchived !== undefined)
    values.isArchived = input.isArchived ? 1 : 0

  const [updated] = await db
    .update(sessions)
    .set(values)
    .where(eq(sessions.id, id))
    .returning()

  return updated || null
}

export async function deleteSession(id: string): Promise<boolean> {
  const sessionDir = path.join(DATA_DIR, "workspace", id)
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true })
  }

  const result = await db
    .delete(sessions)
    .where(eq(sessions.id, id))
    .returning()
  return result.length > 0
}
