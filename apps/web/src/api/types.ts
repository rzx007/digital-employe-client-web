/**
 * 统一 API 响应结构（actus 后端）
 */
export interface ApiResponse<T> {
  code: number
  msg: string
  data: T
}

/**
 * 统一 API 响应结构（simple-agents 后端）
 */
export interface AgentApiResponse<T> {
  code: number
  data: T
  status: number
  message: string
}

/**
 * 员工能力项
 */
export interface Capability {
  capability_name: string
  capability_desc: string
  mcp_server_name: string
  mcp_tool_name: string
}

/**
 * 员工技能（metadata.skills 中的项）
 */
export interface MetadataSkill {
  id: number
  skillName: string
  description: string
  prompt: string
  directoryId: number | null
  status: number
  createTime: string
  updateTime: string
  directoryName: string | null
}

/**
 * 员工元数据（能力描述、MCP 工具绑定等）
 */
export interface EmployeeMetadata {
  employee_name: string
  status: number
  capability_desc: string
  detail_page_url: string | null
  user_id: string
  created_at: string
  updated_at: string
  capabilities: Capability[]
  skills: MetadataSkill[]
}

/**
 * 员工技能文件引用
 */
export interface Skill {
  source: string
  stored_path: string
  name: string
}

/**
 * simple-agents 员工（本地数据库格式）
 */
export interface AgentEmployee {
  id: string
  name: string
  systemPrompt: string
  description: string
  capabilities: string | null
  skills: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 导入员工结果
 */
export interface ImportEmployeeResult {
  employee: AgentEmployee
  skills: string[]
  skillsSynced: boolean
}

/**
 * 数字员工（管理端格式，旧）
 */
export interface Employee {
  id: number
  workspace_id: number
  employee_code: string
  name: string
  description: string | null
  version: string
  skills: Skill[]
  metadata: EmployeeMetadata
  created_at: string
  updated_at: string
}

/**
 * simple-agents 群聊
 */
export interface AgentGroup {
  id: string
  name: string
  employeeIds: string
  createdAt: string
  updatedAt: string
}

/**
 * 群聊（员工组，管理端旧格式）
 */
export interface Group {
  id: number
  workspace_id: number
  name: string
  employee_ids: number[]
  created_at: string
  updated_at: string
}

/**
 * simple-agents 会话
 */
export interface AgentSession {
  id: string
  title: string
  employeeId: string | null
  createdAt: string
  updatedAt: string
  metadata: string | null
  isArchived: boolean
}

/**
 * simple-agents 消息
 */
export interface AgentMessage {
  id: number
  sessionId: string
  role: "user" | "assistant" | "system" | "tool"
  content: string | null
  parts: string | null
  toolCalls: string | null
  toolResults: string | null
  tokenCount: number | null
  createdAt: string
}
