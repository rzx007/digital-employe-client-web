import { db } from "../db"
import { cronTasks, taskRuns } from "../db/schema"
import { eq, and, sql, desc, gte, lte } from "drizzle-orm"
import { nanoid } from "nanoid"
import { fetchEmployeeFromManagement } from "./skill-service"
import { getEmployee } from "./employee-service"
import { chat } from "./agent-service"
import { createSession } from "./session-service"

// ============ 类型定义 ============

export type CronTaskState = {
  nextRunAtMs: number | null
  lastRunAtMs: number | null
  lastStatus: "ok" | "error" | "skipped" | null
  lastError: string | null
}

export type TaskRunStatus =
  | "success"
  | "failed"
  | "pending"
  | "running"
  | "timeout"

export type TaskRunRecord = {
  id: string
  cronTaskId: string
  employeeId: string
  sessionId: string | null
  status: TaskRunStatus
  triggeredAt: string
  completedAt: string | null
  duration: number | null
  result: string | null
  errorMessage: string | null
  createdAt: string
}

export type CronTaskRecord = {
  id: string
  employeeId: string
  taskName: string
  dispatchType: string
  skillId: number | null
  skillName: string | null
  priority: number | null
  cronExpression: string
  taskType: string
  isActive: boolean
  config: string | null
  state: string
  managementTaskId: string | null
  createdAt: string
  updatedAt: string
}

export type TaskSummary = {
  total: number
  completed: number
  failed: number
  pending: number
}

export type ScheduleDay = {
  date: string
  total: number
  success: number
  failed: number
  pending: number
}

export type AnomalyRecord = {
  id: string
  taskRunId: string
  taskName: string
  type: "timeout" | "error" | "duplicate" | "stuck"
  message: string
  occurredAt: string
  resolved: boolean
}

// ============ 管理端数据类型 ============

type ManagementSkill = {
  id: number
  skillName: string
  description: string
  status: number
}

type ManagementTask = {
  task_name: string
  dispatch_type: string
  skill_id: number
  capability_id: number | null
  priority: number
  task_type: number
  cron_expression: string
  cron_expression_type: string
  is_active: boolean
  config: {
    input?: {
      scene?: string
      prompt?: string
    }
  }
}

type ManagementEmployeeData = {
  user_id: string
  employee_name: string
  status: number
  skills?: ManagementSkill[]
  tasks?: ManagementTask[]
}

// ============ 工具函数 ============

function getManagementBaseUrl(): string | null {
  return process.env.MANAGEMENT_BASE_URL || null
}

export function parseState(raw: string | null): CronTaskState {
  try {
    const parsed = JSON.parse(raw || "{}")
    return {
      nextRunAtMs: parsed.nextRunAtMs ?? null,
      lastRunAtMs: parsed.lastRunAtMs ?? null,
      lastStatus: parsed.lastStatus ?? null,
      lastError: parsed.lastError ?? null,
    }
  } catch {
    return {
      nextRunAtMs: null,
      lastRunAtMs: null,
      lastStatus: null,
      lastError: null,
    }
  }
}

export function serializeState(state: CronTaskState): string {
  return JSON.stringify(state)
}

function findSkillName(
  skillId: number,
  skills: ManagementSkill[]
): string | null {
  const skill = skills.find((s) => s.id === skillId)
  return skill?.skillName || null
}

function generateCronSessionId(
  employeeId: string,
  cronTaskId: string,
  dateStr: string
): string {
  const raw = `cron_${employeeId}_${cronTaskId}_${dateStr}`
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return "cron_" + Math.abs(hash).toString(36) + dateStr.replace(/-/g, "")
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// ============ 同步 ============

export async function syncFromManagement(
  employeeId: string
): Promise<{ added: number; updated: number; removed: number }> {
  const baseUrl = getManagementBaseUrl()
  if (!baseUrl) {
    throw new Error("MANAGEMENT_BASE_URL 未配置，无法同步定时任务")
  }

  const emp = await getEmployee(employeeId)
  if (!emp) {
    throw new Error(`员工不存在: ${employeeId}`)
  }

  const data = (await fetchEmployeeFromManagement(
    baseUrl,
    employeeId
  )) as ManagementEmployeeData
  const mgmtTasks: ManagementTask[] = data.tasks || []
  const mgmtSkills: ManagementSkill[] = data.skills || []

  const existingTasks = await db
    .select()
    .from(cronTasks)
    .where(eq(cronTasks.employeeId, employeeId))

  const existingByMgmtId = new Map(
    existingTasks
      .filter((t) => t.managementTaskId)
      .map((t) => [t.managementTaskId, t])
  )

  let added = 0
  let updated = 0
  const mgmtIds = new Set<string>()

  for (const task of mgmtTasks) {
    const mgmtId = `${task.task_name}_${task.cron_expression}`
    mgmtIds.add(mgmtId)

    const skillName = task.skill_id
      ? findSkillName(task.skill_id, mgmtSkills)
      : null

    const values = {
      employeeId,
      taskName: task.task_name,
      dispatchType: task.dispatch_type || "skill",
      skillId: task.skill_id || null,
      skillName,
      priority: task.priority || 0,
      cronExpression: task.cron_expression,
      taskType: String(task.task_type),
      isActive: task.is_active !== false,
      config: task.config ? JSON.stringify(task.config) : null,
      managementTaskId: mgmtId,
      updatedAt: sql`datetime('now')`,
    }

    const existing = existingByMgmtId.get(mgmtId)
    if (existing) {
      const state = parseState(existing.state)
      if (!state.nextRunAtMs) {
        state.nextRunAtMs = await computeNextRunMs(task.cron_expression)
      }

      await db
        .update(cronTasks)
        .set({ ...values, state: serializeState(state) })
        .where(eq(cronTasks.id, existing.id))
      updated++
    } else {
      const nextRunAtMs = await computeNextRunMs(task.cron_expression)
      const id = nanoid()

      await db.insert(cronTasks).values({
        id,
        ...values,
        state: serializeState({
          nextRunAtMs,
          lastRunAtMs: null,
          lastStatus: null,
          lastError: null,
        }),
      })
      added++
    }
  }

  const removed =
    existingTasks.length -
    [...mgmtIds].filter((id) => existingByMgmtId.has(id)).length

  return { added, updated, removed }
}

// ============ CRUD ============

export async function listCronTasks(
  employeeId: string
): Promise<CronTaskRecord[]> {
  const rows = await db
    .select()
    .from(cronTasks)
    .where(eq(cronTasks.employeeId, employeeId))
    .orderBy(desc(cronTasks.createdAt))
  return rows as CronTaskRecord[]
}

export async function listActiveCronTasks(): Promise<
  (CronTaskRecord & { state: CronTaskState })[]
> {
  const rows = await db
    .select()
    .from(cronTasks)
    .where(eq(cronTasks.isActive, true))
  return rows.map((r) => ({
    ...r,
    state: parseState(r.state),
  })) as (CronTaskRecord & { state: CronTaskState })[]
}

export async function getCronTask(
  taskId: string
): Promise<CronTaskRecord | null> {
  const [row] = await db
    .select()
    .from(cronTasks)
    .where(eq(cronTasks.id, taskId))
    .limit(1)
  return (row as CronTaskRecord) || null
}

export async function toggleCronTask(
  taskId: string,
  active: boolean
): Promise<CronTaskRecord | null> {
  const task = await getCronTask(taskId)
  if (!task) return null

  const state = parseState(task.state)
  if (active && !state.nextRunAtMs) {
    state.nextRunAtMs = await computeNextRunMs(task.cronExpression)
  } else if (!active) {
    state.nextRunAtMs = null
  }

  const [updated] = await db
    .update(cronTasks)
    .set({
      isActive: active,
      state: serializeState(state),
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(cronTasks.id, taskId))
    .returning()

  return (updated as CronTaskRecord) || null
}

export async function deleteCronTask(taskId: string): Promise<boolean> {
  const result = await db
    .delete(cronTasks)
    .where(eq(cronTasks.id, taskId))
    .returning()
  return result.length > 0
}

// ============ 任务执行 ============

export async function triggerTask(taskId: string): Promise<TaskRunRecord> {
  const task = await getCronTask(taskId)
  if (!task) {
    throw new Error(`Cron task not found: ${taskId}`)
  }

  const runId = nanoid()
  const now = new Date().toISOString()

  await db.insert(taskRuns).values({
    id: runId,
    cronTaskId: taskId,
    employeeId: task.employeeId,
    status: "running",
    triggeredAt: now,
  })

  const startMs = Date.now()
  let status: TaskRunStatus = "success"
  let result: string | null = null
  let errorMsg: string | null = null
  let sessionId: string | null = null

  try {
    const config = task.config ? JSON.parse(task.config) : {}
    const prompt = config?.input?.prompt || task.taskName

    const dateStr = getTodayStr()
    const cronSessionId = generateCronSessionId(
      task.employeeId,
      taskId,
      dateStr
    )

    const session = await createSession({
      id: cronSessionId,
      title: `[定时任务] ${task.taskName} (${dateStr})`,
      employeeId: task.employeeId,
    })
    sessionId = session.id

    const chatResult = await chat(
      session.id,
      prompt,
      task.employeeId,
      task.skillName || undefined
    )
    result = chatResult.content
  } catch (err: any) {
    status = "failed"
    errorMsg = err?.message || String(err)
  }

  const duration = Date.now() - startMs
  const completedAt = new Date().toISOString()

  const [run] = await db
    .update(taskRuns)
    .set({
      status,
      result,
      errorMessage: errorMsg,
      sessionId,
      completedAt,
      duration,
    })
    .where(eq(taskRuns.id, runId))
    .returning()

  const state: CronTaskState = {
    nextRunAtMs: await computeNextRunMs(task.cronExpression),
    lastRunAtMs: startMs,
    lastStatus: status === "success" ? "ok" : "error",
    lastError: errorMsg,
  }

  await db
    .update(cronTasks)
    .set({
      state: serializeState(state),
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(cronTasks.id, taskId))

  return run as TaskRunRecord
}

// ============ 执行历史 ============

export async function listTaskRuns(
  employeeId: string,
  options?: { date?: string; limit?: number }
): Promise<(TaskRunRecord & { taskName?: string })[]> {
  const limit = options?.limit || 50

  const conditions = [eq(taskRuns.employeeId, employeeId)]

  if (options?.date) {
    conditions.push(gte(taskRuns.triggeredAt, options.date))
    conditions.push(lte(taskRuns.triggeredAt, options.date + "T23:59:59"))
  }

  const rows = await db
    .select({
      run: taskRuns,
      taskName: cronTasks.taskName,
    })
    .from(taskRuns)
    .leftJoin(cronTasks, eq(taskRuns.cronTaskId, cronTasks.id))
    .where(and(...conditions))
    .orderBy(desc(taskRuns.triggeredAt))
    .limit(limit)

  return rows.map((r) => ({
    ...r.run,
    taskName: r.taskName || undefined,
  })) as (TaskRunRecord & { taskName?: string })[]
}

// ============ 统计 ============

export async function getTaskSummary(employeeId: string): Promise<TaskSummary> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      completed: sql<number>`sum(case when status = 'success' then 1 else 0 end)`,
      failed: sql<number>`sum(case when status = 'failed' then 1 else 0 end)`,
      pending: sql<number>`sum(case when status in ('pending', 'running') then 1 else 0 end)`,
    })
    .from(taskRuns)
    .where(eq(taskRuns.employeeId, employeeId))

  return {
    total: Number(row?.total || 0),
    completed: Number(row?.completed || 0),
    failed: Number(row?.failed || 0),
    pending: Number(row?.pending || 0),
  }
}

export async function getMonthlyOverview(
  employeeId: string,
  year: number,
  month: number
): Promise<ScheduleDay[]> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`

  const rows = await db
    .select({
      date: sql<string>`substr(triggered_at, 1, 10)`,
      status: taskRuns.status,
      count: sql<number>`count(*)`,
    })
    .from(taskRuns)
    .where(
      and(
        eq(taskRuns.employeeId, employeeId),
        gte(taskRuns.triggeredAt, startDate),
        lte(taskRuns.triggeredAt, endDate + "T23:59:59")
      )
    )
    .groupBy(sql`substr(triggered_at, 1, 10)`, taskRuns.status)

  const dayMap = new Map<
    string,
    { total: number; success: number; failed: number; pending: number }
  >()

  for (const row of rows) {
    const d = dayMap.get(row.date) || {
      total: 0,
      success: 0,
      failed: 0,
      pending: 0,
    }
    const count = Number(row.count)
    d.total += count
    if (row.status === "success") d.success += count
    else if (row.status === "failed") d.failed += count
    else d.pending += count
    dayMap.set(row.date, d)
  }

  const days: ScheduleDay[] = []
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    const stats = dayMap.get(dateStr)
    days.push({
      date: dateStr,
      total: stats?.total || 0,
      success: stats?.success || 0,
      failed: stats?.failed || 0,
      pending: stats?.pending || 0,
    })
  }

  return days
}

export async function getAnomalies(
  employeeId: string
): Promise<AnomalyRecord[]> {
  const rows = await db
    .select({
      run: taskRuns,
      taskName: cronTasks.taskName,
    })
    .from(taskRuns)
    .leftJoin(cronTasks, eq(taskRuns.cronTaskId, cronTasks.id))
    .where(
      and(
        eq(taskRuns.employeeId, employeeId),
        sql`(${taskRuns.status} = 'failed' OR ${taskRuns.status} = 'timeout')`
      )
    )
    .orderBy(desc(taskRuns.triggeredAt))
    .limit(50)

  return rows.map((r) => ({
    id: r.run.id,
    taskRunId: r.run.id,
    taskName: r.taskName || "未知任务",
    type: (r.run.status === "timeout" ? "timeout" : "error") as
      | "timeout"
      | "error",
    message: r.run.errorMessage || `执行失败 (${r.run.status})`,
    occurredAt: r.run.triggeredAt,
    resolved: r.run.status !== "failed",
  }))
}

// ============ Cron 解析 ============

async function computeNextRunMs(
  cronExpr: string,
  tz?: string
): Promise<number | null> {
  if (!cronExpr) return null
  try {
    const { Cron } = await import("croner")
    const opts: { timezone?: string } = {}
    if (tz) opts.timezone = tz
    const cron = new Cron(cronExpr, opts)
    const next = cron.nextRun()
    return next ? next.getTime() : null
  } catch {
    return null
  }
}

export { computeNextRunMs }
