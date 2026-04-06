/**
 * Type Definitions - 类型定义文件
 *
 * 包含系统中所有共享的类型定义
 * 用于确保类型安全和代码可维护性
 */

// ============ 核心数据类型 ============

/**
 * 员工类型
 *
 * 对应数据库中的 employees 表
 * 每个员工代表一个独立的 AI 角色，拥有专属的系统提示词和技能
 */
export type Employee = {
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
 * 会话类型
 *
 * 对应数据库中的 sessions 表
 * 会话可选关联一个员工（employeeId），继承员工的配置
 */
export type Session = {
  id: string
  title: string
  employeeId: string | null
  createdAt: string
  updatedAt: string
  metadata: string | null
  isArchived: boolean
}

/**
 * 消息类型
 *
 * 对应数据库中的 messages 表
 */
export type Message = {
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

/**
 * 文件产物类型
 *
 * 对应数据库中的 artifacts 表
 */
export type Artifact = {
  id: string
  sessionId: string
  filePath: string
  fileName: string
  fileSize: number
  mimeType: string
  description: string | null
  createdAt: string
}

// ============ 请求/响应类型 ============

/**
 * 创建员工的输入参数
 */
export type CreateEmployeeInput = {
  id?: string
  name: string
  systemPrompt?: string
  description?: string
}

/**
 * 更新员工的输入参数
 */
export type UpdateEmployeeInput = {
  name?: string
  systemPrompt?: string
  description?: string
}

/**
 * 创建会话的输入参数
 */
export type CreateSessionInput = {
  id?: string
  title?: string
  metadata?: Record<string, unknown>
  employeeId?: string
}

/**
 * 更新会话的输入参数
 */
export type UpdateSessionInput = {
  title?: string
  metadata?: Record<string, unknown>
  isArchived?: boolean
}

export type Group = {
  id: string
  name: string
  employeeIds: string
  createdAt: string
  updatedAt: string
}

export type CreateGroupInput = {
  id?: string
  name: string
  employeeIds: string[]
}

export type UpdateGroupInput = {
  name?: string
  employeeIds?: string[]
}

/**
 * 发送消息的输入参数
 */
export type SendMessageInput = {
  message: string
  skill?: string
}

/**
 * 会话列表查询参数
 */
export type ListSessionsQuery = {
  page?: number
  pageSize?: number
  includeArchived?: boolean
}

/**
 * 消息列表查询参数
 */
export type ListMessagesQuery = {
  page?: number
  pageSize?: number
  before?: number
}

/**
 * 分页结果类型
 */
export type PaginatedResult<T> = {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ============ 流相关类型 ============

/**
 * 流任务状态
 *
 * 用于标识流式对话的当前状态
 */
export type StreamTaskStatus =
  | "pending" // 等待开始
  | "streaming" // 正在流式处理
  | "completed" // 已完成
  | "failed" // 失败
  | "cancelled" // 已取消

/**
 * 流任务类型
 *
 * 对应数据库中的 stream_tasks 表
 */
export type StreamTask = {
  id: string
  sessionId: string
  status: StreamTaskStatus
  content: string
  errorMessage: string | null
  messageId: number | null
  createdAt: string
  updatedAt: string
}

/**
 * 流事件类型
 *
 * 通过 SSE 向客户端推送 LangGraph stream() 事件
 *
 * 事件类型：
 * - stream_start: 流开始
 * - messages: LangGraph messages 模式 → [AIMessageChunk, metadata] 元组
 * - updates: LangGraph updates 模式 → {nodeName: stateUpdate}
 * - interrupt: Agent 遇到 interruptOn 触发的人机协作暂停
 * - done: 流完成
 * - error: 流出错
 * - cancelled: 流取消
 */
export type StreamEvent =
  | { type: "stream_start"; streamId: string }
  | {
      type: "messages"
      chunk: {
        content?: string | any[]
        tool_call_chunks?: Array<{
          name?: string
          args?: string
          id?: string
          index?: number
        }>
        tool_calls?: Array<{
          name?: string
          args?: string | Record<string, unknown>
          id?: string
          type?: string
        }>
        additional_kwargs?: Record<string, unknown>
      }
      metadata?: Record<string, any>
    }
  | { type: "updates"; data: Record<string, any> }
  | { type: "interrupt"; interrupts: any[] }
  | { type: "done"; messageId: number; streamId: string }
  | { type: "error"; message: string; streamId: string }
  | { type: "cancelled"; streamId: string }
