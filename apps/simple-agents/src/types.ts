export type Session = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  metadata: string | null
  isArchived: boolean
}

export type Message = {
  id: number
  sessionId: string
  role: "user" | "assistant" | "system" | "tool"
  content: string | null
  toolCalls: string | null
  toolResults: string | null
  tokenCount: number | null
  createdAt: string
}

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

export type CreateSessionInput = {
  id?: string
  title?: string
  metadata?: Record<string, unknown>
}

export type UpdateSessionInput = {
  title?: string
  metadata?: Record<string, unknown>
  isArchived?: boolean
}

export type SendMessageInput = {
  message: string
}

export type ListSessionsQuery = {
  page?: number
  pageSize?: number
  includeArchived?: boolean
}

export type ListMessagesQuery = {
  page?: number
  pageSize?: number
  before?: number
}

export type PaginatedResult<T> = {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type StreamTaskStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled"

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

export type StreamEvent =
  | { type: "stream_start"; streamId: string }
  | { type: "token"; content: string }
  | { type: "tool_start"; name: string; input?: unknown }
  | { type: "tool_end"; name: string; output?: string }
  | { type: "done"; messageId: number; streamId: string }
  | { type: "error"; message: string; streamId: string }
  | { type: "cancelled"; streamId: string }
