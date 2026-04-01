/**
 * Skill Service - 技能链接服务
 *
 * 核心职责：
 * 1. 在创建会话时，通过符号链接将技能目录映射到会话工作区
 * 2. 管理技能文件的目录结构
 * 3. 从管理端下载技能 zip 并解压到员工技能目录
 *
 * 技能分层架构：
 * - 全局技能：data/skills/ → 会话目录 skills/（符号链接）
 *   所有会话共享的基础技能，始终加载（手动放置）
 *
 * - 员工专属技能：data/employees/{employeeId}/skills/ → 会话目录 employee-skills/（符号链接）
 *   每个员工独立拥有的技能，通过管理端导入
 *
 * 符号链接方案：
 * - Windows 上使用 junction（目录连接），不需要管理员权限
 * - 创建链接而非复制，源文件更新立即对所有会话生效
 * - 不占用额外磁盘空间
 * - 技能文件是只读的（agent 只用 read_file 读取），链接安全
 *
 * 管理端同步：
 * - 通过 MANAGEMENT_BASE_URL 从管理端下载技能 zip
 * - 清空旧目录后解压，保证与 zip 内容完全一致
 * - 下载失败不影响员工创建（技能目录为空即可）
 *
 * DeepAgents 技能加载机制：
 * - agent 配置 skills: ["/skills/", "/employee-skills/"]
 * - SkillsMiddleware 在运行时通过 backend 的 globInfo() 扫描目录
 * - 查找 *​/SKILL.md 文件，解析 YAML frontmatter 获取技能元信息
 * - 将技能名称和描述注入系统提示词（渐进式披露）
 * - agent 需要时通过 read_file 工具读取完整 SKILL.md
 */

import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { getDataDir } from "../db"
import extractZip from "extract-zip"

/**
 * 全局技能目录路径
 *
 * 存放所有员工共享的基础技能
 * 结构：data/skills/{skill-name}/SKILL.md
 */
const getGlobalSkillsDir = () => path.join(getDataDir(), "skills")

const getEmployeesDir = () => path.join(getDataDir(), "employees")


/**
 * 确保必要的目录结构存在
 *
 * 在服务启动时调用，创建全局技能目录和员工根目录
 */
export function ensureSkillDirs(): void {
  console.log("[Simple Agents] Global skills dir:", getGlobalSkillsDir())
  if (!fs.existsSync(getGlobalSkillsDir())) {
    fs.mkdirSync(getGlobalSkillsDir(), { recursive: true })
  }
  console.log("[Simple Agents] Employees dir:", getEmployeesDir())
  if (!fs.existsSync(getEmployeesDir())) {
    fs.mkdirSync(getEmployeesDir(), { recursive: true })
  }
}

/**
 * 为会话创建技能目录的符号链接
 *
 * 执行逻辑：
 * 1. 将全局技能目录链接到会话的 skills/
 * 2. 如果有员工 ID，将员工专属技能链接到会话的 employee-skills/
 * 3. 源目录不存在时静默跳过
 * 4. 目标已存在时跳过（避免重复创建）
 *
 * 符号链接特性：
 * - Windows 使用 junction，跨平台使用 symlink
 * - 源文件修改立即对所有会话生效，无需重新同步
 * - 删除链接不影响源文件
 *
 * @param sessionId 会话 ID
 * @param employeeId 员工 ID（可选）
 */
export function linkSessionSkills(
  sessionId: string,
  employeeId?: string
): void {
  const sessionDir = path.join(getDataDir(), "workspace", sessionId)

  // 链接全局技能
  const globalTarget = path.join(sessionDir, "skills")
  linkIfSourceExists(getGlobalSkillsDir(), globalTarget)

  // 链接员工专属技能
  if (employeeId) {
    const empSkillsDir = path.join(getEmployeesDir(), employeeId, "skills")
    const empTarget = path.join(sessionDir, "employee-skills")
    linkIfSourceExists(empSkillsDir, empTarget)
  }
}

/**
 * 获取员工可用的技能列表
 *
 * 合并全局技能和员工专属技能，返回技能目录名列表
 *
 * @param employeeId 员工 ID（可选）
 * @returns 技能名称列表
 */
export function listAvailableSkills(employeeId?: string): string[] {
  const skillNames = new Set<string>()

  // 扫描全局技能
  scanSkillDir(getGlobalSkillsDir(), skillNames)

  // 扫描员工专属技能
  if (employeeId) {
    const empSkillsDir = path.join(getEmployeesDir(), employeeId, "skills")
    scanSkillDir(empSkillsDir, skillNames)
  }

  return Array.from(skillNames)
}

export type SkillMetadata = {
  name: string
  description: string
}

/**
 * 获取员工可用的技能元信息列表
 *
 * 扫描全局和员工专属技能目录，解析 SKILL.md 的 YAML frontmatter
 * 提取 name 和 description 字段
 *
 * @param employeeId 员工 ID（可选，不传则只返回全局技能）
 * @returns 技能元信息列表
 */
export function listSkillMetadata(employeeId?: string): SkillMetadata[] {
  const skills: SkillMetadata[] = []

  scanSkillMetadata(getGlobalSkillsDir(), skills)

  if (employeeId) {
    const empSkillsDir = path.join(getEmployeesDir(), employeeId, "skills")
    scanSkillMetadata(empSkillsDir, skills)
  }

  return skills
}

function scanSkillMetadata(dir: string, skills: SkillMetadata[]): void {
  if (!fs.existsSync(dir)) return

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const skillMd = path.join(dir, entry.name, "SKILL.md")
    if (!fs.existsSync(skillMd)) continue

    const content = fs.readFileSync(skillMd, "utf-8")
    const metadata = parseSkillFrontmatter(content)
    if (metadata) {
      skills.push(metadata)
    } else {
      skills.push({ name: entry.name, description: "" })
    }
  }
}

function parseSkillFrontmatter(content: string): SkillMetadata | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return null

  const body = match[1]
  const name = /^name:\s*(.+)$/m.exec(body)?.[1]?.trim()
  const description = /^description:\s*(.+)$/m.exec(body)?.[1]?.trim()

  if (!name) return null

  return { name, description: description || "" }
}

/**
 * 获取员工专属技能目录路径
 *
 * @param employeeId 员工 ID
 * @returns 技能目录路径
 */
export function getEmployeeSkillsDir(employeeId: string): string {
  return path.join(getEmployeesDir(), employeeId, "skills")
}

/**
 * 删除员工的技能目录
 *
 * 在删除员工时调用
 *
 * @param employeeId 员工 ID
 */
export function removeEmployeeSkillsDir(employeeId: string): void {
  const empDir = path.join(getEmployeesDir(), employeeId)
  if (fs.existsSync(empDir)) {
    fs.rmSync(empDir, { recursive: true, force: true })
  }
}

/**
 * 如果源目录存在，创建符号链接到目标路径
 *
 * - 源目录不存在时静默跳过
 * - 目标不存在时创建链接
 * - 目标存在但指向错误路径或为 dangling symlink 时重建
 * - 目标存在且正确时跳过
 * - Windows 使用 junction（不需要管理员权限）
 * - 其他平台使用 symlink
 *
 * @param src 源目录（实际存放技能的目录）
 * @param dest 目标路径（会话工作区内的链接路径）
 */
function linkIfSourceExists(src: string, dest: string): void {
  if (!fs.existsSync(src)) return

  const srcResolved = path.resolve(src)
  const destResolved = path.resolve(dest)

  if (fs.existsSync(dest)) {
    try {
      const currentTarget = fs.realpathSync(destResolved)
      if (currentTarget === srcResolved) return
    } catch {
      // dangling symlink or broken junction
    }
    fs.rmSync(destResolved, { recursive: false, force: true })
  }

  if (process.platform === "win32") {
    fs.symlinkSync(srcResolved, destResolved, "junction")
  } else {
    fs.symlinkSync(srcResolved, destResolved, "dir")
  }
}

/**
 * 删除会话中员工技能的符号链接
 *
 * @param sessionId 会话 ID
 */
export function unlinkSessionEmployeeSkills(sessionId: string): void {
  const target = path.join(
    getDataDir(),
    "workspace",
    sessionId,
    "employee-skills"
  )
  try {
    fs.realpathSync(target)
    fs.rmSync(target, { recursive: false, force: true })
  } catch {
    // 不存在或不是 symlink，忽略
  }
}

/**
 * 扫描技能目录，收集技能名称
 *
 * 在目录下查找包含 SKILL.md 的子目录，将其目录名作为技能名称
 *
 * @param dir 要扫描的目录
 * @param skillNames 技能名称集合（会修改此集合）
 */
function scanSkillDir(dir: string, skillNames: Set<string>): void {
  if (!fs.existsSync(dir)) return

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillMd = path.join(dir, entry.name, "SKILL.md")
      if (fs.existsSync(skillMd)) {
        skillNames.add(entry.name)
      }
    }
  }
}

/**
 * 管理端接口路径常量
 *
 * 当 MANAGEMENT_BASE_URL 配置后，使用这些路径拼接完整的 API 地址
 * 后续管理端接口路径变更时，只需修改此处常量
 */
const EMPLOYEE_API_PATH = "/employees/"
const SKILLS_ZIP_PATH = "/skills.zip"

/**
 * 从管理端下载员工数据
 *
 * @param baseUrl 管理端地址（如 http://localhost:3000）
 * @param userId 管理端的员工 ID
 * @returns 管理端返回的员工 JSON 数据
 * @throws Error 当未配置 baseUrl 或请求失败时
 */
export async function fetchEmployeeFromManagement(
  baseUrl: string,
  userId: string
): Promise<Record<string, unknown>> {
  const url = `${baseUrl}${EMPLOYEE_API_PATH}${userId}`

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `管理端请求失败: ${response.status} ${response.statusText} (${url})`
    )
  }

  return response.json() as Promise<Record<string, unknown>>
}

/**
 * 从管理端下载技能 zip 并解压到员工技能目录
 *
 * 执行逻辑：
 * 1. 拼接 zip 下载 URL
 * 2. 下载 zip 到临时文件
 * 3. 清空员工现有技能目录
 * 4. 解压到临时目录
 * 5. 扫描解压结果，过滤出包含 SKILL.md 的合法技能目录
 * 6. 将合法目录移动到员工技能目录
 * 7. 清理临时文件
 *
 * 容错：
 * - zip 下载失败 → 抛出错误（调用方决定是否忽略）
 * - zip 格式异常 → 抛出错误
 * - 解压后无合法技能 → 返回空数组（不报错）
 *
 * @param baseUrl 管理端地址
 * @param userId 员工 ID（管理端的 user_id）
 * @returns 成功解压的技能名称列表
 */
export async function downloadAndExtractSkills(
  baseUrl: string,
  userId: string
): Promise<string[]> {
  const zipUrl = `${baseUrl}${EMPLOYEE_API_PATH}${userId}${SKILLS_ZIP_PATH}`
  const empSkillsDir = path.join(getEmployeesDir(), userId, "skills")

  // 1. 下载 zip 到临时文件
  const response = await fetch(zipUrl)
  if (!response.ok) {
    throw new Error(
      `技能下载失败: ${response.status} ${response.statusText} (${zipUrl})`
    )
  }

  if (!response.body) {
    throw new Error("技能下载失败: 响应体为空")
  }

  const tmpZipPath = path.join(
    os.tmpdir(),
    `skills-${userId}-${Date.now()}.zip`
  )
  const tmpExtractDir = path.join(os.tmpdir(), `skills-${userId}-${Date.now()}`)

  try {
    // 将响应流写入临时文件
    const zipBuffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(tmpZipPath, zipBuffer)

    // 2. 清空现有技能目录
    if (fs.existsSync(empSkillsDir)) {
      fs.rmSync(empSkillsDir, { recursive: true, force: true })
    }
    fs.mkdirSync(empSkillsDir, { recursive: true })

    // 3. 解压到临时目录
    fs.mkdirSync(tmpExtractDir, { recursive: true })
    await extractZip(tmpZipPath, { dir: tmpExtractDir })

    // 4. 扫描解压结果，过滤合法技能目录（必须包含 SKILL.md）
    const validSkills = new Set<string>()
    scanSkillDir(tmpExtractDir, validSkills)

    // 5. 将合法技能目录移动到员工技能目录
    for (const skillName of validSkills) {
      const src = path.join(tmpExtractDir, skillName)
      const dest = path.join(empSkillsDir, skillName)
      fs.cpSync(src, dest, { recursive: true })
    }

    return Array.from(validSkills)
  } finally {
    // 6. 清理临时文件
    try {
      if (fs.existsSync(tmpZipPath)) fs.unlinkSync(tmpZipPath)
      if (fs.existsSync(tmpExtractDir))
        fs.rmSync(tmpExtractDir, { recursive: true, force: true })
    } catch {
      // 清理失败不影响主流程
    }
  }
}
