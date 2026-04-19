import { Hono } from "hono"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { getRootDir } from "../config"

const app = new Hono()

const getDataPath = () => join(getRootDir(), "src", "employees", "data.json")
const getSkillsZipPath = () => join(getRootDir(), "static", "skills.zip")

app.get("/employees/:userId", async (c) => {
  const userId = c.req.param("userId")
  const DATA_PATH = getDataPath()

  if (!existsSync(DATA_PATH)) {
    return c.json({ error: "员工数据文件不存在" }, 500)
  }

  const raw = readFileSync(DATA_PATH, "utf-8")
  const employees: Record<string, unknown>[] = JSON.parse(raw)

  const employee = employees.find((e) => String(e.user_id) === userId)

  if (!employee) {
    return c.json({ error: `未找到员工: ${userId}` }, 404)
  }

  return c.json(employee)
})

app.get("/employees/:userId/skills.zip", async (c) => {
  const userId = c.req.param("userId")
  const SKILLS_ZIP_PATH = getSkillsZipPath()

  if (!existsSync(SKILLS_ZIP_PATH)) {
    return c.json({ error: "技能 zip 文件不存在" }, 500)
  }

  const zipBuffer = readFileSync(SKILLS_ZIP_PATH)

  c.header("Content-Type", "application/zip")
  c.header("Content-Disposition", `attachment; filename="skills-${userId}.zip"`)
  return c.body(zipBuffer)
})

export default app
