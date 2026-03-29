/**
 * Employees Routes - 员工管理路由
 *
 * 提供员工相关的 HTTP 端点：
 *
 * 1. POST   /api/employees                    - 创建员工（本地）
 * 2. POST   /api/employees/import/:userId     - 从管理端导入员工
 * 3. POST   /api/employees/:id/sync           - 重新同步员工
 * 4. GET    /api/employees                    - 列出所有员工
 * 5. GET    /api/employees/:id                - 获取员工详情
 * 6. PATCH  /api/employees/:id                - 更新员工
 * 7. DELETE /api/employees/:id                - 删除员工
 *
 * 设计说明：
 * - 员工是 AI 角色的抽象，拥有专属的 systemPrompt 和 skills
 * - 主要通过管理端导入（import），本地创建仅用于开发测试
 * - 同步接口用于管理端修改员工后，更新 simple-agents 侧的数据和技能
 * - 更新员工 systemPrompt 后自动清除对应的 Agent 缓存
 * - 删除员工时保留关联会话（employee_id 置 null）
 */

import { Hono } from "hono"
import {
  createEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
  deleteEmployee,
  importEmployee,
  syncEmployee,
} from "../services/employee-service"
import type { CreateEmployeeInput, UpdateEmployeeInput } from "../types"

const app = new Hono()

/**
 * POST / - 创建员工
 *
 * @param body.name 员工名称（必填）
 * @param body.systemPrompt 系统提示词（可选）
 * @param body.description 描述（可选）
 * @returns 创建的员工对象
 */
app.post("/", async (c) => {
  const body = await c.req.json<CreateEmployeeInput>()

  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required (string)" }, 400)
  }

  try {
    const employee = await createEmployee(body)
    return c.json(employee, 201)
  } catch (error: any) {
    return c.json({ error: error.message || "Failed to create employee" }, 500)
  }
})

/**
 * POST /import/:userId - 从管理端导入员工
 *
 * 从管理端拉取员工数据和技能 zip，upsert 到本地数据库。
 * 如果员工已存在则更新，不存在则创建。
 * 技能下载失败不阻塞导入（员工已保存，只是没有技能）。
 *
 * @param userId 管理端的员工 ID（user_id）
 * @returns 导入结果（员工对象 + 技能列表 + 是否同步成功）
 */
app.post("/import/:userId", async (c) => {
  const userId = c.req.param("userId")

  try {
    const result = await importEmployee(userId)
    return c.json(result, 201)
  } catch (error: any) {
    const msg = error.message || "Failed to import employee"
    if (msg.includes("MANAGEMENT_BASE_URL")) {
      return c.json({ error: msg }, 501)
    }
    if (msg.includes("管理端请求失败") || msg.includes("技能下载失败")) {
      return c.json({ error: msg }, 502)
    }
    return c.json({ error: msg }, 500)
  }
})

/**
 * GET / - 列出所有员工
 *
 * @returns 员工列表（按创建时间降序）
 */
app.get("/", async (c) => {
  const employees = await listEmployees()
  return c.json(employees)
})

/**
 * GET /:id - 获取员工详情
 *
 * @param id 员工 ID
 * @returns 员工对象
 */
app.get("/:id", async (c) => {
  const id = c.req.param("id")
  const employee = await getEmployee(id)
  if (!employee) return c.json({ error: "Employee not found" }, 404)
  return c.json(employee)
})

/**
 * PATCH /:id - 更新员工
 *
 * 注意：更新 systemPrompt 后会自动清除对应的 Agent 缓存，
 * 下次对话时会用新提示词重建 Agent 实例
 *
 * @param id 员工 ID
 * @param body 更新的参数（name、systemPrompt、description）
 * @returns 更新后的员工对象
 */
app.patch("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<UpdateEmployeeInput>()

  const employee = await updateEmployee(id, body)
  if (!employee) return c.json({ error: "Employee not found" }, 404)
  return c.json(employee)
})

/**
 * DELETE /:id - 删除员工
 *
 * 执行逻辑：
 * - 删除数据库记录（关联会话的 employee_id 自动置 null）
 * - 删除员工目录（包含专属技能文件）
 * - 清除 Agent 缓存
 *
 * @param id 员工 ID
 * @returns 删除结果
 */
app.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const deleted = await deleteEmployee(id)
  if (!deleted) return c.json({ error: "Employee not found" }, 404)
  return c.json({ success: true })
})

/**
 * POST /:id/sync - 重新同步员工
 *
 * 从管理端重新拉取员工数据和技能 zip，更新本地记录。
 * 用于管理端修改了员工信息或技能后，在 simple-agents 侧更新。
 *
 * @param id 本地员工 ID（即管理端的 user_id）
 * @returns 同步结果（员工对象 + 技能列表 + 是否同步成功）
 */
app.post("/:id/sync", async (c) => {
  const id = c.req.param("id")

  try {
    const result = await syncEmployee(id)
    return c.json(result)
  } catch (error: any) {
    const msg = error.message || "Failed to sync employee"
    if (msg.includes("员工不存在")) {
      return c.json({ error: msg }, 404)
    }
    if (msg.includes("MANAGEMENT_BASE_URL")) {
      return c.json({ error: msg }, 501)
    }
    if (msg.includes("管理端请求失败") || msg.includes("技能下载失败")) {
      return c.json({ error: msg }, 502)
    }
    return c.json({ error: msg }, 500)
  }
})

export default app
