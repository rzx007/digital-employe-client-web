/**
 * Session Service - 会话管理服务
 *
 * 职责：
 * 1. 创建/获取/更新/删除会话
 * 2. 列出所有会话（支持分页、过滤、按员工过滤）
 * 3. 管理会话对应的文件目录
 * 4. 创建会话时同步技能文件
 *
 * 会话是系统的基本组织单位，每个会话有：
 * - 唯一 ID
 * - 标题
 * - 所属员工 ID（可选，关联 employees 表）
 * - 时间戳
 * - 元数据（JSON）
 * - 独立的文件目录（data/workspace/{sessionId}/）
 *   ├── skills/              ← 全局技能副本
 *   └── employee-skills/     ← 员工专属技能副本
 */

import type { CreateSessionInput, UpdateSessionInput, Session } from "../types"
import { getDb } from "../db"
import { getDataDir } from "../config"
import { sessions } from "../db/schema"
import { eq, desc, sql, and } from "drizzle-orm"
import { nanoid } from "nanoid"
import path from "node:path"
import fs from "node:fs"
import { linkSessionSkills } from "./skill-service"
import { getEmployee } from "./employee-service"

/**
 * 创建新会话
 *
 * 执行逻辑：
 * 1. 生成或使用指定的会话 ID
 * 2. 如果指定了 employeeId，验证员工存在
 * 3. 在数据库中创建会话记录
 * 4. 创建对应的文件目录
 * 5. 同步全局技能和员工专属技能到会话目录
 *
 * @param input 会话创建参数（可选）
 * @returns 创建的会话对象
 * @throws Error 当 employeeId 指定的员工不存在时
 */
export async function createSession(
  input: CreateSessionInput = {}
): Promise<Session> {
  const id = input.id || nanoid()
  const employeeId = input.employeeId || null
  const metadata = input.metadata ? JSON.stringify(input.metadata) : null

  // 验证员工存在（如果指定了 employeeId）
  if (employeeId) {
    const emp = await getEmployee(employeeId)
    if (!emp) {
      throw new Error(`Employee not found: ${employeeId}`)
    }
  }

  // 在数据库中创建会话记录
  const [session] = await getDb()
    .insert(sessions)
    .values({
      id,
      title: input.title || "新会话",
      employeeId,
      metadata,
    })
    .returning()

  // 创建对应的文件目录
  const sessionDir = path.join(getDataDir(), "workspace", id)
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
  }

  // 创建技能目录符号链接（全局 + 员工专属）
  linkSessionSkills(id, employeeId || undefined)

  return session
}

/**
 * 获取单个会话
 *
 * @param id 会话 ID
 * @returns 会话对象，不存在时返回 null
 */
export async function getSession(id: string): Promise<Session | null> {
  const [session] = await getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)
  return session || null
}

/**
 * 列出所有会话
 *
 * 支持分页和过滤：
 * - page: 页码（从 1 开始）
 * - pageSize: 每页条数（默认 20）
 * - includeArchived: 是否包含已归档的会话
 * - employeeId: 按员工过滤（可选）
 *
 * @param page 页码
 * @param pageSize 每页条数
 * @param includeArchived 是否包含已归档会话
 * @param employeeId 按员工过滤
 * @returns 分页的会话列表
 */
export async function listSessions(
  page = 1,
  pageSize = 20,
  includeArchived = false,
  employeeId?: string
) {
  // 构建查询条件
  const conditions = includeArchived
    ? undefined
    : and(eq(sessions.isArchived, false))

  // 按员工过滤
  const finalWhere = employeeId
    ? and(conditions, eq(sessions.employeeId, employeeId))
    : conditions

  // 查询总数
  const [{ count }] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(sessions)
    .where(finalWhere)

  // 查询数据（按更新时间降序，支持分页）
  const data = await getDb()
    .select()
    .from(sessions)
    .where(finalWhere)
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

/**
 * 更新会话
 *
 * 支持更新的字段：
 * - title: 会话标题
 * - metadata: 元数据
 * - isArchived: 归档状态
 *
 * @param id 会话 ID
 * @param input 更新内容
 * @returns 更新后的会话对象，不存在时返回 null
 */
export async function updateSession(
  id: string,
  input: UpdateSessionInput
): Promise<Session | null> {
  // 构建更新值
  const values: Record<string, unknown> = { updatedAt: sql`datetime('now')` }
  if (input.title !== undefined) values.title = input.title
  if (input.metadata !== undefined)
    values.metadata = JSON.stringify(input.metadata)
  if (input.isArchived !== undefined)
    values.isArchived = input.isArchived ? 1 : 0

  // 更新数据库
  const [updated] = await getDb()
    .update(sessions)
    .set(values)
    .where(eq(sessions.id, id))
    .returning()

  return updated || null
}

/**
 * 删除会话
 *
 * 执行逻辑：
 * 1. 删除会话对应的文件目录（递归删除，包括技能副本和所有文件）
 * 2. 删除数据库中的会话记录（级联删除消息和产物记录）
 *
 * @param id 会话 ID
 * @returns 是否成功删除
 */
export async function deleteSession(id: string): Promise<boolean> {
  // 删除会话目录
  const sessionDir = path.join(getDataDir(), "workspace", id)
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true })
  }

  // 删除数据库记录（级联删除关联的 messages 和 artifacts）
  const result = await getDb()
    .delete(sessions)
    .where(eq(sessions.id, id))
    .returning()
  return result.length > 0
}
