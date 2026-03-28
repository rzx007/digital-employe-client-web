import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("新会话"),
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

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["user", "assistant", "system", "tool"],
  }).notNull(),
  content: text("content"),
  toolCalls: text("tool_calls"),
  toolResults: text("tool_results"),
  tokenCount: integer("token_count"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
})

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
