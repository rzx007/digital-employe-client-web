import type { CreateGroupInput, UpdateGroupInput, Group } from "../types"
import { db } from "../db"
import { groups } from "../db/schema"
import { eq, desc } from "drizzle-orm"
import { nanoid } from "nanoid"

export async function createGroup(input: CreateGroupInput): Promise<Group> {
  const id = input.id || nanoid()

  const [group] = await db
    .insert(groups)
    .values({
      id,
      name: input.name,
      employeeIds: JSON.stringify(input.employeeIds),
    })
    .returning()

  return group
}

export async function getGroup(id: string): Promise<Group | null> {
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, id))
    .limit(1)
  return group || null
}

export async function listGroups(): Promise<Group[]> {
  return db.select().from(groups).orderBy(desc(groups.createdAt))
}

export async function updateGroup(
  id: string,
  input: UpdateGroupInput
): Promise<Group | null> {
  const values: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }
  if (input.name !== undefined) values.name = input.name
  if (input.employeeIds !== undefined)
    values.employeeIds = JSON.stringify(input.employeeIds)

  const [updated] = await db
    .update(groups)
    .set(values)
    .where(eq(groups.id, id))
    .returning()

  return updated || null
}

export async function deleteGroup(id: string): Promise<boolean> {
  const result = await db.delete(groups).where(eq(groups.id, id)).returning()

  return result.length > 0
}
