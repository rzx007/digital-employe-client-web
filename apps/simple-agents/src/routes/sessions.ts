/**
 * Sessions Routes - 会话管理路由
 *
 * 提供会话相关的 HTTP 端点：
 *
 * 1. POST   /api/sessions      - 创建新会话
 * 2. GET    /api/sessions      - 列出所有会话（支持分页、按员工过滤）
 * 3. GET    /api/sessions/:id  - 获取单个会话
 * 4. PATCH  /api/sessions/:id  - 更新会话
 * 5. DELETE /api/sessions/:id  - 删除会话
 */

import { Hono } from "hono"
import {
  createSession,
  getSession,
  listSessions,
  updateSession,
  deleteSession,
} from "../services/session-service"
import type { CreateSessionInput, UpdateSessionInput } from "../types"

const app = new Hono()

/**
 * POST / - 创建新会话
 *
 * @param body.title 会话标题（可选，默认 "新会话"）
 * @param body.employeeId 所属员工 ID（可选）
 * @param body.metadata 元数据（可选）
 * @returns 创建的会话对象
 */
app.post("/", async (c) => {
  const body = await c.req.json<CreateSessionInput>()

  try {
    const session = await createSession(body)
    return c.json(session, 201)
  } catch (error: any) {
    // employeeId 对应的员工不存在时返回 400
    if (error.message?.startsWith("Employee not found")) {
      return c.json({ error: error.message }, 400)
    }
    return c.json({ error: error.message || "Failed to create session" }, 500)
  }
})

/**
 * GET / - 列出所有会话
 *
 * @param page 页码（默认 1）
 * @param pageSize 每页条数（默认 20）
 * @param includeArchived 是否包含已归档会话
 * @param employeeId 按员工过滤
 * @returns 分页的会话列表
 */
app.get("/", async (c) => {
  const page = Number(c.req.query("page")) || 1
  const pageSize = Number(c.req.query("pageSize")) || 20
  const includeArchived = c.req.query("includeArchived") === "true"
  const employeeId = c.req.query("employeeId") || undefined

  const result = await listSessions(page, pageSize, includeArchived, employeeId)
  return c.json(result)
})

/**
 * GET /:id - 获取单个会话
 *
 * @param id 会话 ID
 * @returns 会话对象
 */
app.get("/:id", async (c) => {
  const id = c.req.param("id")
  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)
  return c.json(session)
})

/**
 * PATCH /:id - 更新会话
 *
 * @param id 会话 ID
 * @param body 更新的参数（title、metadata、isArchived）
 * @returns 更新后的会话对象
 */
app.patch("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<UpdateSessionInput>()
  const session = await updateSession(id, body)
  if (!session) return c.json({ error: "Session not found" }, 404)
  return c.json(session)
})

/**
 * DELETE /:id - 删除会话
 *
 * 会删除会话记录、消息、产物和对应的文件目录
 *
 * @param id 会话 ID
 * @returns 删除结果
 */
app.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const deleted = await deleteSession(id)
  if (!deleted) return c.json({ error: "Session not found" }, 404)
  return c.json({ success: true })
})

export default app
