/**
 * Database Schema - 数据库表结构定义
 *
 * 使用 Drizzle ORM 定义 SQLite 数据库的表结构
 * 包含 6 个核心表：employees、groups、sessions、messages、artifacts、stream_tasks
 *
 * 关系说明：
 * - employees 是员工表（顶层实体）
 * - groups 是群聊表，通过 employeeIds 关联多个员工
 * - sessions 关联 employees（可选，onDelete: set null）
 * - messages、artifacts、stream_tasks 都有外键关联到 sessions
 * - 使用 CASCADE 删除，删除会话时自动删除关联记录
 *
 * 分层架构：
 * - employees → sessions（一对多，员工下有多个对话）
 * - employees, groups → 群聊包含多个员工
 * - sessions → messages/artifacts/stream_tasks（一对多）
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

/**
 * 员工表 (employees)
 *
 * 存储所有员工的基本信息，每个员工代表一个 AI 角色
 *
 * 字段说明：
 * - id: 唯一标识符（nanoid 生成）
 * - name: 员工名称（如 "代码专家"、"数据分析师"）
 * - system_prompt: 员工专属系统提示词（定义 AI 行为和能力）
 * - description: 员工描述信息
 * - capabilities: 能力列表（JSON 字符串，从管理端同步，前端展示用）
 * - skills: 技能列表（JSON 字符串，从管理端同步，前端展示用）
 * - created_at: 创建时间
 * - updated_at: 更新时间
 *
 * 与会话的关系：
 * - 一个员工可以有多个会话（sessions 表通过 employee_id 关联）
 * - 删除员工时，关联会话的 employee_id 被置为 null（保留会话数据）
 */
export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  systemPrompt: text("system_prompt").notNull().default(""),
  description: text("description").notNull().default(""),
  capabilities: text("capabilities"),
  skills: text("skills"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  employeeIds: text("employee_ids").notNull().default("[]"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})

/**
 * 会话表 (sessions)
 *
 * 存储所有会话的基本信息
 *
 * 字段说明：
 * - id: 唯一标识符（nanoid 生成）
 * - title: 会话标题（默认 "新会话"）
 * - employee_id: 所属员工 ID（外键，可选，关联 employees 表）
 * - created_at: 创建时间
 * - updated_at: 更新时间（每次对话后更新）
 * - metadata: 元数据（JSON 字符串）
 * - is_archived: 是否已归档（软删除标记）
 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("新会话"),
  employeeId: text("employee_id").references(() => employees.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  metadata: text("metadata"),
  isArchived: integer("is_archived", { mode: "boolean" })
    .notNull()
    .default(false),
})

/**
 * 消息表 (messages)
 *
 * 存储对话中的所有消息
 *
 * 字段说明：
 * - id: 自增主键
 * - session_id: 外键，关联到 sessions 表
 * - role: 消息角色（user/assistant/system/tool）
 * - content: 消息内容
 * - parts: AI SDK UIMessage parts（JSON 字符串，包含文本、工具调用等完整结构）
 * - tool_calls: 工具调用信息（JSON 字符串）
 * - tool_results: 工具返回结果（JSON 字符串）
 * - token_count: token 计数
 * - created_at: 创建时间
 */
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["user", "assistant", "system", "tool"],
  }).notNull(),
  content: text("content"),
  parts: text("parts"),
  toolCalls: text("tool_calls"),
  toolResults: text("tool_results"),
  tokenCount: integer("token_count"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})

/**
 * 文件产物表 (artifacts)
 *
 * 存储 agent 在对话过程中产生的文件元数据
 *
 * 字段说明：
 * - id: 唯一标识符（nanoid 生成）
 * - session_id: 外键，关联到 sessions 表
 * - file_path: 文件相对路径（相对于会话目录）
 * - file_name: 文件名
 * - file_size: 文件大小（字节）
 * - mime_type: MIME 类型
 * - description: 文件描述（可选）
 * - created_at: 创建时间
 */
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  description: text("description"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})

/**
 * 流任务表 (stream_tasks)
 *
 * 存储流式对话的任务记录，用于页面重载恢复
 *
 * 字段说明：
 * - id: 流任务唯一标识符（nanoid 生成）
 * - session_id: 外键，关联到 sessions 表
 * - status: 任务状态（pending/streaming/completed/failed/cancelled）
 * - content: 已累积的代理回复内容（用于断线恢复）
 * - error_message: 错误信息（仅 failed 状态）
 * - message_id: 关联的消息 ID（仅 completed 状态）
 * - created_at: 创建时间
 * - updated_at: 更新时间
 *
 * 生命周期：
 * - 创建时：status = "pending"
 * - 开始流式处理：status = "streaming"，content 逐渐累积
 * - 完成：status = "completed"，关联到 messages 表
 * - 失败：status = "failed"，记录错误信息
 * - 取消：status = "cancelled"
 */
export const cronTasks = sqliteTable("cron_tasks", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  taskName: text("task_name").notNull(),
  dispatchType: text("dispatch_type").notNull().default("skill"),
  skillId: integer("skill_id"),
  skillName: text("skill_name"),
  priority: integer("priority").default(0),
  cronExpression: text("cron_expression").notNull(),
  taskType: text("task_type").notNull().default("2"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  config: text("config"),
  state: text("state").notNull().default("{}"),
  managementTaskId: text("management_task_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const taskRuns = sqliteTable("task_runs", {
  id: text("id").primaryKey(),
  cronTaskId: text("cron_task_id")
    .notNull()
    .references(() => cronTasks.id, { onDelete: "cascade" }),
  employeeId: text("employee_id").notNull(),
  sessionId: text("session_id"),
  status: text("status", {
    enum: ["success", "failed", "pending", "running", "timeout"],
  })
    .notNull()
    .default("pending"),
  triggeredAt: text("triggered_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text("completed_at"),
  duration: integer("duration"),
  result: text("result"),
  errorMessage: text("error_message"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})

export const streamTasks = sqliteTable("stream_tasks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["pending", "streaming", "completed", "failed", "cancelled"],
  })
    .notNull()
    .default("pending"),
  content: text("content").notNull().default(""),
  errorMessage: text("error_message"),
  messageId: integer("message_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})
