import {
  listActiveCronTasks,
  triggerTask,
  parseState,
  serializeState,
  computeNextRunMs,
} from "../services/cron-task-service"
import { db } from "../db"
import { cronTasks } from "../db/schema"
import { eq } from "drizzle-orm"

function nowMs(): number {
  return Date.now()
}

export interface CronSchedulerOptions {
  timezone?: string
  onTick?: (taskId: string) => void
}

export class CronScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private timezone: string
  private onTick?: (taskId: string) => void
  private executing = new Set<string>()

  constructor(options: CronSchedulerOptions = {}) {
    this.timezone = options.timezone || "Asia/Shanghai"
    this.onTick = options.onTick
  }

  async start(): Promise<void> {
    this.running = true

    const activeTasks = await listActiveCronTasks()
    let updatedCount = 0

    for (const task of activeTasks) {
      const state = parseState(task.state)
      if (state.nextRunAtMs == null) {
        const nextRunAtMs = await computeNextRunMs(
          task.cronExpression,
          this.timezone
        )
        if (nextRunAtMs != null) {
          await db
            .update(cronTasks)
            .set({
              state: serializeState({ ...state, nextRunAtMs }),
            })
            .where(eq(cronTasks.id, task.id))
          updatedCount++
        }
      }
    }

    console.log(
      `[CronScheduler] Started with ${activeTasks.length} active tasks, ${updatedCount} updated nextRunAtMs`
    )
    this.armTimer()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    console.log("[CronScheduler] Stopped")
  }

  private async getNextWakeMs(): Promise<number | null> {
    const activeTasks = await listActiveCronTasks()
    const times = activeTasks
      .filter((t) => t.state?.nextRunAtMs != null && !this.executing.has(t.id))
      .map((t) => t.state.nextRunAtMs!)

    return times.length > 0 ? Math.min(...times) : null
  }

  private armTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.getNextWakeMs().then((next) => {
      if (next == null || !this.running) return

      const delay = Math.max(0, next - nowMs())
      const nextDate = new Date(next).toISOString()

      console.log(
        `[CronScheduler] Next wake in ${Math.round(delay / 1000)}s at ${nextDate}`
      )

      this.timer = setTimeout(() => {
        this.timer = null
        this.onTimer().catch((err) =>
          console.error("[CronScheduler] Timer error:", err)
        )
      }, delay)
    })
  }

  private async onTimer(): Promise<void> {
    const activeTasks = await listActiveCronTasks()
    const now = nowMs()

    const due = activeTasks.filter(
      (t) =>
        t.isActive &&
        t.state.nextRunAtMs != null &&
        now >= t.state.nextRunAtMs &&
        !this.executing.has(t.id)
    )

    for (const task of due) {
      this.executing.add(task.id)
      this.onTick?.(task.id)

      try {
        await triggerTask(task.id)
        console.log(
          `[CronScheduler] Task completed: ${task.taskName} (${task.id})`
        )
      } catch (err) {
        console.error(
          `[CronScheduler] Task failed: ${task.taskName} (${task.id}):`,
          err
        )
      } finally {
        this.executing.delete(task.id)
      }
    }

    this.armTimer()
  }

  notifyTaskChanged(_taskId: string): void {
    if (this.running) {
      this.armTimer()
    }
  }
}
