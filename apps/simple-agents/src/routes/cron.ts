import { Hono } from "hono"
import { getEmployee } from "../services/employee-service"
import {
  syncFromManagement,
  listCronTasks,
  toggleCronTask,
  deleteCronTask,
  triggerTask,
  listTaskRuns,
  getTaskSummary,
  getMonthlyOverview,
  getAnomalies,
  getCronTask,
} from "../services/cron-task-service"
import { cronScheduler } from "../app"

const app = new Hono()

app.post("/:employeeId/sync", async (c) => {
  const employeeId = c.req.param("employeeId")
  const emp = await getEmployee(employeeId)
  if (!emp) return c.json({ error: "Employee not found" }, 404)

  try {
    const result = await syncFromManagement(employeeId)
    cronScheduler.notifyTaskChanged(employeeId)
    return c.json(result)
  } catch (error: any) {
    const msg = error.message || "Failed to sync cron tasks"
    if (msg.includes("MANAGEMENT_BASE_URL")) {
      return c.json({ error: msg }, 501)
    }
    return c.json({ error: msg }, 500)
  }
})

app.get("/:employeeId/tasks", async (c) => {
  const employeeId = c.req.param("employeeId")
  const emp = await getEmployee(employeeId)
  if (!emp) return c.json({ error: "Employee not found" }, 404)

  const tasks = await listCronTasks(employeeId)
  return c.json(tasks)
})

app.patch("/tasks/:id/toggle", async (c) => {
  const taskId = c.req.param("id")
  const body = await c.req.json<{ active: boolean }>()

  if (typeof body.active !== "boolean") {
    return c.json({ error: "active (boolean) is required" }, 400)
  }

  const task = await toggleCronTask(taskId, body.active)
  if (!task) return c.json({ error: "Cron task not found" }, 404)

  cronScheduler.notifyTaskChanged(taskId)
  return c.json(task)
})

app.delete("/tasks/:id", async (c) => {
  const taskId = c.req.param("id")
  const deleted = await deleteCronTask(taskId)
  if (!deleted) return c.json({ error: "Cron task not found" }, 404)

  cronScheduler.notifyTaskChanged(taskId)
  return c.json({ success: true })
})

app.post("/tasks/:id/trigger", async (c) => {
  const taskId = c.req.param("id")
  const task = await getCronTask(taskId)
  if (!task) return c.json({ error: "Cron task not found" }, 404)

  try {
    const run = await triggerTask(taskId)
    return c.json(run, 201)
  } catch (error: any) {
    return c.json({ error: error.message || "Trigger failed" }, 500)
  }
})

app.get("/:employeeId/runs", async (c) => {
  const employeeId = c.req.param("employeeId")
  const date = c.req.query("date")
  const limit = Number(c.req.query("limit")) || 50

  const runs = await listTaskRuns(employeeId, { date, limit })
  return c.json(runs)
})

app.get("/:employeeId/summary", async (c) => {
  const employeeId = c.req.param("employeeId")
  const summary = await getTaskSummary(employeeId)
  return c.json(summary)
})

app.get("/:employeeId/calendar", async (c) => {
  const employeeId = c.req.param("employeeId")
  const year = Number(c.req.query("year")) || new Date().getFullYear()
  const month = Number(c.req.query("month")) || new Date().getMonth() + 1

  const days = await getMonthlyOverview(employeeId, year, month)
  return c.json(days)
})

app.get("/:employeeId/anomalies", async (c) => {
  const employeeId = c.req.param("employeeId")
  const anomalies = await getAnomalies(employeeId)
  return c.json(anomalies)
})

export default app
