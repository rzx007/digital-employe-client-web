export type TaskRunStatus =
  | "success"
  | "failed"
  | "pending"
  | "running"
  | "timeout"
  | "stuck"

export type AnomalyType = "timeout" | "error" | "duplicate" | "stuck"

export interface TaskRun {
  id: string
  taskId: string
  taskName: string
  employeeId: string
  cronExpression: string
  cronDescription: string
  status: TaskRunStatus
  triggeredAt: string
  completedAt: string | null
  duration: number | null
  result: string | null
  log: string | null
}

export interface ScheduleDay {
  date: string
  total: number
  success: number
  failed: number
  pending: number
}

export interface AnomalyRecord {
  id: string
  taskRunId: string
  taskName: string
  type: AnomalyType
  message: string
  occurredAt: string
  resolved: boolean
}

export interface MonthlyOverview {
  year: number
  month: number
  days: ScheduleDay[]
}

export interface TaskSummary {
  total: number
  completed: number
  failed: number
  pending: number
}
