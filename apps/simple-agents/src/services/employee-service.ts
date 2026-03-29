/**
 * Employee Service - 员工管理服务
 *
 * 核心职责：
 * 1. 员工的 CRUD 操作（创建/获取/列表/更新/删除）
 * 2. 从管理端导入员工（数据 + 技能）
 * 3. 重新同步员工（更新数据 + 技能）
 * 4. 员工专属目录管理（技能目录）
 * 5. 员工配置变更时通知 Agent 缓存失效
 *
 * 员工来源：
 * - 本地创建：用于开发测试，手动指定 name/systemPrompt
 * - 管理端导入：从外部管理系统拉取员工数据（正式流程）
 *   - 管理端数据接口: GET {MANAGEMENT_BASE_URL}/employees/{userId}
 *   - 技能下载接口: GET {MANAGEMENT_BASE_URL}/employees/{userId}/skills.zip
 *
 * 管理端字段映射：
 *   user_id          → id（唯一标识）
 *   employee_name    → name
 *   system_prompt    → systemPrompt
 *   description      → description
 *
 * 生命周期：
 * - 导入员工：拉取数据 → upsert DB → 下载技能 zip → 解压
 * - 同步员工：重新拉取数据 → 更新 DB → 清空技能 → 重新解压
 * - 删除员工：删除记录、删除目录、清除缓存（会话保留，employee_id 置 null）
 */

import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
  Employee,
} from "../types"
import { db } from "../db"
import { employees } from "../db/schema"
import { eq, desc } from "drizzle-orm"
import { nanoid } from "nanoid"
import {
  ensureSkillDirs,
  getEmployeeSkillsDir,
  removeEmployeeSkillsDir,
  fetchEmployeeFromManagement,
  downloadAndExtractSkills,
} from "./skill-service"
import { invalidateAgentCache } from "../agent"
import fs from "node:fs"

/**
 * 管理端未配置的错误消息
 */
const MANAGEMENT_NOT_CONFIGURED = "MANAGEMENT_BASE_URL 未配置，无法从管理端导入"

/**
 * 创建新员工
 *
 * 执行逻辑：
 * 1. 确保技能基础目录存在
 * 2. 生成员工 ID
 * 3. 在数据库中创建员工记录
 * 4. 创建员工专属技能目录
 *
 * @param input 创建参数（name 必填）
 * @returns 创建的员工对象
 */
export async function createEmployee(
  input: CreateEmployeeInput
): Promise<Employee> {
  // 确保目录结构存在
  ensureSkillDirs()

  const id = input.id || nanoid()

  // 创建数据库记录
  const [employee] = await db
    .insert(employees)
    .values({
      id,
      name: input.name,
      systemPrompt: input.systemPrompt || "",
      description: input.description || "",
    })
    .returning()

  // 创建员工专属技能目录
  const skillsDir = getEmployeeSkillsDir(id)
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true })
  }

  return employee
}

/**
 * 获取单个员工
 *
 * @param id 员工 ID
 * @returns 员工对象，不存在时返回 null
 */
export async function getEmployee(id: string): Promise<Employee | null> {
  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, id))
    .limit(1)
  return employee || null
}

/**
 * 列出所有员工
 *
 * 按创建时间降序排列
 *
 * @returns 员工列表
 */
export async function listEmployees(): Promise<Employee[]> {
  return db.select().from(employees).orderBy(desc(employees.createdAt))
}

/**
 * 更新员工
 *
 * 支持更新的字段：name、systemPrompt、description
 *
 * 重要：更新 systemPrompt 后必须通知 Agent 缓存失效，
 * 因为 Agent 工厂在创建实例时会读取 systemPrompt
 *
 * @param id 员工 ID
 * @param input 更新内容
 * @returns 更新后的员工对象，不存在时返回 null
 */
export async function updateEmployee(
  id: string,
  input: UpdateEmployeeInput
): Promise<Employee | null> {
  const values: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }
  if (input.name !== undefined) values.name = input.name
  if (input.systemPrompt !== undefined) values.systemPrompt = input.systemPrompt
  if (input.description !== undefined) values.description = input.description

  const [updated] = await db
    .update(employees)
    .set(values)
    .where(eq(employees.id, id))
    .returning()

  if (updated) {
    // systemPrompt 变更后，缓存中的 agent 实例已过时，需要清除
    invalidateAgentCache(id)
  }

  return updated || null
}

/**
 * 删除员工
 *
 * 执行逻辑：
 * 1. 删除数据库记录（关联会话的 employee_id 自动置 null）
 * 2. 删除员工专属目录（包含技能文件）
 * 3. 清除该员工的 Agent 缓存
 *
 * @param id 员工 ID
 * @returns 是否成功删除
 */
export async function deleteEmployee(id: string): Promise<boolean> {
  // 删除数据库记录
  const result = await db
    .delete(employees)
    .where(eq(employees.id, id))
    .returning()

  if (result.length > 0) {
    // 删除员工目录
    removeEmployeeSkillsDir(id)
    // 清除 Agent 缓存
    invalidateAgentCache(id)
    return true
  }

  return false
}

/**
 * 获取管理端基础 URL
 *
 * @returns 管理端地址，未配置时返回 null
 */
function getManagementBaseUrl(): string | null {
  return process.env.MANAGEMENT_BASE_URL || null
}

/**
 * 将管理端员工数据映射为本地数据库字段
 *
 * 管理端字段 → 本地字段：
 *   user_id          → id
 *   employee_name    → name
 *   system_prompt    → systemPrompt
 *   description      → description
 *
 * @param data 管理端返回的员工 JSON 数据
 * @returns 映射后的字段对象
 */
function mapManagementEmployee(data: Record<string, unknown>): {
  id: string
  name: string
  systemPrompt: string
  description: string
} {
  return {
    id: String(data.user_id || ""),
    name: String(data.employee_name || "未命名员工"),
    systemPrompt: String(data.system_prompt || ""),
    description: String(data.description || ""),
  }
}

/**
 * 导入结果类型
 *
 * 包含员工对象和技能同步结果
 */
export type ImportEmployeeResult = {
  employee: Employee
  skills: string[]
  skillsSynced: boolean
}

/**
 * 从管理端导入员工
 *
 * 执行逻辑：
 * 1. 检查 MANAGEMENT_BASE_URL 是否配置
 * 2. 从管理端获取员工数据
 * 3. upsert 到本地数据库（存在则更新）
 * 4. 创建技能目录
 * 5. 下载技能 zip 并解压（失败不阻塞）
 * 6. 失效 Agent 缓存
 *
 * @param userId 管理端的员工 ID（即 user_id）
 * @returns 导入结果（员工对象 + 技能列表 + 是否同步成功）
 * @throws Error 当 MANAGEMENT_BASE_URL 未配置或管理端不可达时
 */
export async function importEmployee(
  userId: string
): Promise<ImportEmployeeResult> {
  const baseUrl = getManagementBaseUrl()
  if (!baseUrl) {
    throw new Error(MANAGEMENT_NOT_CONFIGURED)
  }

  // 1. 从管理端获取员工数据
  const data = await fetchEmployeeFromManagement(baseUrl, userId)
  const mapped = mapManagementEmployee(data)

  if (!mapped.id) {
    throw new Error("管理端数据缺少 user_id 字段")
  }

  // 2. Upsert 到本地数据库
  ensureSkillDirs()

  const existing = await getEmployee(mapped.id)

  let employee: Employee
  if (existing) {
    const [updated] = await db
      .update(employees)
      .set({
        name: mapped.name,
        systemPrompt: mapped.systemPrompt,
        description: mapped.description,
      })
      .where(eq(employees.id, mapped.id))
      .returning()
    employee = updated!
  } else {
    const [created] = await db
      .insert(employees)
      .values({
        id: mapped.id,
        name: mapped.name,
        systemPrompt: mapped.systemPrompt,
        description: mapped.description,
      })
      .returning()
    employee = created
  }

  // 3. 确保技能目录存在
  const skillsDir = getEmployeeSkillsDir(employee.id)
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true })
  }

  // 4. 下载并解压技能（失败不阻塞导入）
  let skills: string[] = []
  let skillsSynced = false
  try {
    skills = await downloadAndExtractSkills(baseUrl, employee.id)
    skillsSynced = true
  } catch (err: any) {
    console.warn(`[employee:${employee.id}] 技能同步失败: ${err.message}`)
  }

  // 5. 失效 Agent 缓存（systemPrompt 可能变了）
  invalidateAgentCache(employee.id)

  return { employee, skills, skillsSynced }
}

/**
 * 重新同步员工（数据 + 技能）
 *
 * 用于管理端修改了员工信息或技能后，在 simple-agents 侧更新
 *
 * 执行逻辑：
 * 1. 检查员工是否存在于本地
 * 2. 检查 MANAGEMENT_BASE_URL 是否配置
 * 3. 重新从管理端拉取数据并更新 DB
 * 4. 清空技能目录并重新下载解压
 * 5. 失效 Agent 缓存
 *
 * @param id 本地员工 ID（即管理端的 user_id）
 * @returns 同步结果
 * @throws Error 当员工不存在或管理端未配置时
 */
export async function syncEmployee(id: string): Promise<ImportEmployeeResult> {
  // 检查员工是否存在于本地
  const existing = await getEmployee(id)
  if (!existing) {
    throw new Error(`员工不存在: ${id}`)
  }

  const baseUrl = getManagementBaseUrl()
  if (!baseUrl) {
    throw new Error(MANAGEMENT_NOT_CONFIGURED)
  }

  // 1. 重新从管理端获取数据并更新 DB
  const data = await fetchEmployeeFromManagement(baseUrl, id)
  const mapped = mapManagementEmployee(data)

  const [updated] = await db
    .update(employees)
    .set({
      name: mapped.name,
      systemPrompt: mapped.systemPrompt,
      description: mapped.description,
    })
    .where(eq(employees.id, id))
    .returning()

  if (!updated) {
    throw new Error(`更新员工失败: ${id}`)
  }

  // 2. 清空技能目录并重新下载解压
  let skills: string[] = []
  let skillsSynced = false
  try {
    skills = await downloadAndExtractSkills(baseUrl, id)
    skillsSynced = true
  } catch (err: any) {
    console.warn(`[employee:${id}] 技能同步失败: ${err.message}`)
  }

  // 3. 失效 Agent 缓存
  invalidateAgentCache(id)

  return { employee: updated, skills, skillsSynced }
}
