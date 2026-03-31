import type {
  AnomalyRecord,
  MonthlyOverview,
  ScheduleDay,
  TaskRun,
  TaskSummary,
} from "@/types/schedule-monitor"

const MOCK_TASKS = [
  {
    taskId: "task-1",
    taskName: "每日考勤汇总",
    cronExpression: "0 9 * * *",
    cronDescription: "每天 09:00",
  },
  {
    taskId: "task-2",
    taskName: "周报自动生成",
    cronExpression: "0 18 * * 5",
    cronDescription: "每周五 18:00",
  },
  {
    taskId: "task-3",
    taskName: "邮件分类整理",
    cronExpression: "0 10 * * *",
    cronDescription: "每天 10:00",
  },
  {
    taskId: "task-4",
    taskName: "数据同步检查",
    cronExpression: "0 8 * * *",
    cronDescription: "每天 08:00",
  },
  {
    taskId: "task-5",
    taskName: "客户跟进提醒",
    cronExpression: "0 9 * * 1-5",
    cronDescription: "工作日 09:00",
  },
  {
    taskId: "task-6",
    taskName: "招聘渠道统计",
    cronExpression: "0 7 * * 1",
    cronDescription: "每周一 07:00",
  },
  {
    taskId: "task-7",
    taskName: "合同到期预警",
    cronExpression: "0 9 1 * *",
    cronDescription: "每月 1 日 09:00",
  },
  {
    taskId: "task-8",
    taskName: "绩效考核汇总",
    cronExpression: "0 9 25 * *",
    cronDescription: "每月 25 日 09:00",
  },
]

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function generateMonthlyOverview(
  employeeId: string,
  year: number,
  month: number
): MonthlyOverview {
  const rng = seededRandom(hashString(employeeId + `${year}-${month}`))
  const daysInMonth = new Date(year, month, 0).getDate()
  const days: ScheduleDay[] = []

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    const now = new Date()
    const dayDate = new Date(year, month - 1, d)

    if (dayDate > now) {
      days.push({ date, total: 0, success: 0, failed: 0, pending: 0 })
      continue
    }

    const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6
    const baseTaskCount = isWeekend ? 2 : 5
    const variance = Math.floor(rng() * 3) - 1
    const total = Math.max(0, baseTaskCount + variance)
    const failed = rng() > 0.7 ? Math.floor(rng() * 2) + 1 : 0
    const pending =
      dayDate.toDateString() === now.toDateString() ? Math.floor(rng() * 2) : 0
    const success = Math.max(0, total - failed - pending)

    days.push({ date, total, success, failed, pending })
  }

  return { year, month, days }
}

export function generateTodayTaskRuns(employeeId: string): TaskRun[] {
  const now = new Date()
  const rng = seededRandom(hashString(employeeId + now.toDateString()))
  const taskCount = 8
  const runs: TaskRun[] = []

  for (let i = 0; i < taskCount; i++) {
    const task = MOCK_TASKS[i % MOCK_TASKS.length]
    const hour = 7 + Math.floor(rng() * 12)
    const minute = Math.floor(rng() * 60)
    const triggeredAt = new Date(now)
    triggeredAt.setHours(hour, minute, 0, 0)

    if (triggeredAt > now) continue

    const roll = rng()
    let status: TaskRun["status"]
    let duration: number | null
    let log: string | null
    let result: string | null

    if (roll < 0.6) {
      status = "success"
      duration = 1000 + Math.floor(rng() * 8000)
      log = `[${task.taskName}] 开始执行...\n[${task.taskName}] 正在处理数据...\n[${task.taskName}] 执行完成 ✓`
      result = `处理完成，共处理 ${Math.floor(rng() * 50) + 10} 条记录`
    } else if (roll < 0.75) {
      status = "failed"
      duration = 2000 + Math.floor(rng() * 10000)
      log = `[${task.taskName}] 开始执行...\n[${task.taskName}] 处理中...\n[${task.taskName}] 错误: Connection refused`
      result = null
    } else if (roll < 0.85) {
      status = "timeout"
      duration = 30000
      log = `[${task.taskName}] 开始执行...\n[${task.taskName}] 等待响应超时 (30s)`
      result = null
    } else if (roll < 0.95) {
      status = "pending"
      duration = null
      log = null
      result = null
    } else {
      status = "running"
      duration = null
      log = `[${task.taskName}] 开始执行...\n[${task.taskName}] 正在处理数据...`
      result = null
    }

    runs.push({
      id: `run-${i}`,
      taskId: task.taskId,
      taskName: task.taskName,
      employeeId,
      cronExpression: task.cronExpression,
      cronDescription: task.cronDescription,
      status,
      triggeredAt: triggeredAt.toISOString(),
      completedAt:
        status === "pending" || status === "running"
          ? null
          : new Date(triggeredAt.getTime() + (duration ?? 0)).toISOString(),
      duration,
      result,
      log,
    })
  }

  return runs.sort(
    (a, b) =>
      new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
  )
}

export function generateTaskSummary(employeeId: string): TaskSummary {
  const runs = generateTodayTaskRuns(employeeId)
  return {
    total: runs.length,
    completed: runs.filter((r) => r.status === "success").length,
    failed: runs.filter((r) => r.status === "failed" || r.status === "timeout")
      .length,
    pending: runs.filter(
      (r) => r.status === "pending" || r.status === "running"
    ).length,
  }
}

export function generateAnomalies(_employeeId: string): AnomalyRecord[] {
  return [
    {
      id: "anomaly-1",
      taskRunId: "run-2",
      taskName: "邮件分类整理",
      type: "timeout",
      message: "执行超时，已等待 30s 未收到响应",
      occurredAt: new Date(new Date().setHours(10, 0, 12, 0)).toISOString(),
      resolved: false,
    },
    {
      id: "anomaly-2",
      taskRunId: "run-3",
      taskName: "数据同步检查",
      type: "error",
      message: "Connection refused: 后端服务不可达",
      occurredAt: new Date(new Date().setHours(8, 30, 0, 0)).toISOString(),
      resolved: false,
    },
    {
      id: "anomaly-3",
      taskRunId: "run-5",
      taskName: "客户跟进提醒",
      type: "duplicate",
      message: "检测到重复执行，与 08:59:58 的任务重复",
      occurredAt: new Date(new Date().setHours(9, 0, 1, 0)).toISOString(),
      resolved: true,
    },
  ]
}

export function formatTaskDuration(ms: number | null): string {
  if (ms == null) return "-"
  return formatDuration(ms)
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash) || 1
}
