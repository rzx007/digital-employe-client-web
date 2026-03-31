清楚了。以下是完整的集成方案。

---

## 定时任务集成方案

### 架构总览

```
管理端 ──同步──→ simple-agents
                    │
                    ├─ 1. cron-sync API: 拉取管理端 tasks
                    ├─ 2. CronService (重构): SQLite 持久化
                    ├─ 3. onJob 回调: 创建 session → 调用 agent skill
                    ├─ 4. REST API: 任务管理 + 执行历史
                    │
                    ▼
               apps/web (前端)
                    │
                    ├─ api/cron.ts: CRUD hooks
                    ├─ hooks 替换 mock → 真实 API
                    └─ schedule-monitor 组件对接真实数据
```

### 分步实施计划

#### Phase 1: 后端 — 数据层 + CronService 重构

**1.1 新增 DB 表 (`db/schema.ts`)**

```typescript
// cron_tasks 表：存储从管理端同步的定时任务
export const cronTasks = sqliteTable("cron_tasks", {
  id: text("id").primaryKey(),                     // nanoid
  employeeId: text("employee_id").notNull(),        // 关联员工
  taskName: text("task_name").notNull(),
  dispatchType: text("dispatch_type").notNull(),    // "skill"
  skillId: integer("skill_id"),
  skillName: text("skill_name"),                   // 从 skills[] 匹配
  priority: integer("priority").default(0),
  cronExpression: text("cron_expression").notNull(),
  taskType: text("task_type").notNull().default("2"), // "1"=一次性 "2"=周期性
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  config: text("config"),                           // JSON: { input: { prompt, scene } }
  state: text("state").notNull().default("{}"),     // JSON: { nextRunAtMs, lastStatus... }
  managementTaskId: text("management_task_id"),     // 管理端原始 task 标识
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
})

// task_runs 表：记录每次任务执行的历史
export const taskRuns = sqliteTable("task_runs", {
  id: text("id").primaryKey(),                      // nanoid
  cronTaskId: text("cron_task_id").notNull().references(() => cronTasks.id),
  employeeId: text("employee_id").notNull(),
  sessionId: text("session_id"),                    // 关联产生的 session
  status: text("status", { enum: ["success","failed","pending","running","timeout"] })
    .notNull().default("pending"),
  triggeredAt: text("triggered_at").notNull().default(sql`(datetime('now'))`),
  completedAt: text("completed_at"),
  duration: integer("duration"),                    // 毫秒
  result: text("result"),                           // agent 返回的内容
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
})
```

**1.2 重构 CronService**

将现有 `cron/service.ts` 从 JSON 文件持久化改为 SQLite：

- `loadStore()` → 查询 `cron_tasks` 表（`isActive=true`）
- `saveStore()` → 单条 `UPDATE` 即可（每次执行后更新 state）
- `addJob()` → 不再需要（由同步接口 upsert）
- `removeJob()` → `DELETE FROM cron_tasks WHERE id=?`
- `onJob` 回调签名改为接收 cronTask 记录
- 保留单定时器架构 (`armTimer` → `getNextWakeMs` → `onTimer` → `executeJob`)

**1.3 新增 cron-service.ts**

```typescript
// apps/simple-agents/src/services/cron-service.ts

export class CronTaskService {
  // 从管理端同步 tasks → upsert 到 cron_tasks 表
  async syncFromManagement(employeeId: string): Promise<{ added: number; updated: number }>

  // 列出员工的定时任务
  async listByEmployee(employeeId: string): Promise<CronTask[]>

  // 启用/禁用任务
  async toggleTask(taskId: string, active: boolean): Promise<void>

  // 手动触发执行
  async triggerManually(taskId: string): Promise<TaskRun>

  // 查询执行历史
  async listRuns(employeeId: string, date?: string): Promise<TaskRun[]>

  // 统计数据（给 monitor panel 用）
  async getSummary(employeeId: string): Promise<TaskSummary>
  async getMonthlyOverview(employeeId: string, year: number, month: number): Promise<ScheduleDay[]>
  async getAnomalies(employeeId: string): Promise<AnomalyRecord[]>
}
```

**1.4 任务执行核心逻辑**

CronService 的 `onJob` 回调：

```typescript
onJob: async (cronTask) => {
  const task = await db.select().from(cronTasks).where(eq(cronTasks.id, cronTask.id))
  if (!task || !task.isActive) return

  // 1. 创建 task_run 记录 (status: "running")
  const run = await createTaskRun(cronTask)

  // 2. 创建/复用 session（按 cronTask+日期复用同一天的 session）
  const sessionId = await getOrCreateCronSession(cronTask)

  // 3. 调用 agent（同步即可，不需要流式）
  const prompt = JSON.parse(task.config).input.prompt
  const { content } = await chat(sessionId, prompt, task.employeeId, task.skillName)

  // 4. 更新 task_run (status: "success", result: content)
  await updateTaskRun(run.id, { status: "success", result: content })
}
```

#### Phase 2: 后端 — API 路由

**2.1 新增 `routes/cron.ts`**

```
POST   /api/cron/:employeeId/sync        → 从管理端同步定时任务
GET    /api/cron/:employeeId/tasks        → 列出员工的定时任务
PATCH  /api/cron/tasks/:id/toggle         → 启用/禁用任务
DELETE /api/cron/tasks/:id                → 删除任务
POST   /api/cron/tasks/:id/trigger        → 手动触发执行
GET    /api/cron/:employeeId/runs         → 执行历史
GET    /api/cron/:employeeId/summary      → 统计汇总
GET    /api/cron/:employeeId/calendar     → 月度日历数据
GET    /api/cron/:employeeId/anomalies    → 异常记录
```

**2.2 接入 App 生命周期**

在 `app.ts` 或 `index.ts` 中启动 CronService：

```typescript
// 服务启动时
await cronService.start()
// 服务关闭时
cronService.stop()
```

#### Phase 3: 前端 — 对接真实数据

**3.1 新增 `api/cron.ts`**

对应后端 API 的 fetch 函数，使用 `agentRequest` 实例。

**3.2 替换 `hooks/use-schedule-monitor-queries.ts`**

将 `generateTodayTaskRuns` 等 mock 调用替换为 `api/cron.ts` 的真实 API 调用。类型 `TaskRun`, `TaskSummary` 等前端已定义好（`types/schedule-monitor.ts`），基本可直接复用。

**3.3 调整 Monitor Panel**

- `execution-detail.tsx`: 展示真实 task run 记录
- `schedule-calendar.tsx`: 展示真实的每日执行统计
- `task-stats-cards.tsx`: 展示真实的汇总数据

#### Phase 4: 关键细节

| 决策点 | 方案 |
|--------|------|
| 一次性任务 (cron 表达一个时间点) | croner 计算出 `nextRun` 后判断是否只匹配一次，执行后 `isActive=false` |
| session 管理 | 按 `{employeeId}_{cronTaskId}_{YYYY-MM-DD}` 生成固定 sessionId，同一天同一任务复用 session |
| 并发控制 | CronService 是串行执行到期任务；同一 session 不能同时有两个 agent 执行 |
| 时区 | 统一使用 `Asia/Shanghai`（croner 支持 tz 参数） |
| 同步策略 | 管理端是 source of truth，同步时以管理端数据为准，全量覆盖（本地新增的 `state` 字段保留） |

### 工作量估算

| Phase | 改动文件数 | 复杂度 |
|-------|-----------|--------|
| Phase 1: 数据层 + CronService 重构 | ~5 个新/改文件 | **高** |
| Phase 2: API 路由 + 生命周期 | ~3 个文件 | **中** |
| Phase 3: 前端对接 | ~4 个文件 | **中** |
| Phase 4: DB migration + 测试 | ~2 个文件 | **低** |

### 建议实施顺序

1. 先跑 `drizzle-kit generate` 创建 migration
2. Phase 1 → Phase 2 → Phase 3 顺序推进
3. Phase 3 中可以逐步替换 mock，不必一次性全换

---
## 执行流程
```
CronScheduler.start()
  → 查询所有 isActive=true 的任务，计算 nextRunAtMs
  → armTimer() 设置 setTimeout 到最近的 nextRunAtMs
  → 到期 → onTimer() → triggerTask(taskId)
    → 创建 task_run (status: running)
    → 创建/复用 session (cron_{hash}_{date})
    → chat(sessionId, prompt, employeeId, skillName)
    → 更新 task_run (status/ result/ duration)
    → 更新 cron_task.state (lastStatus/ nextRunAtMs)
    → armTimer() 继续等待下一次
```