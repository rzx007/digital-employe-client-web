import type { StreamEvent } from "../types"

type Subscriber = (event: StreamEvent) => void

export type ActiveTask = {
  id: string
  sessionId: string
  status: "streaming" | "completed" | "failed" | "cancelled"
  content: string
  errorMessage: string | null
  messageId: number | null
  subscribers: Set<Subscriber>
  abortController: AbortController
  completed: boolean
}

const tasks = new Map<string, ActiveTask>()
const sessionIndex = new Map<string, string>()

const TASK_TTL_MS = 5 * 60 * 1000

function cleanup(): void {
  const now = Date.now()
  for (const [id, task] of tasks) {
    if (task.completed && now - parseTimestamp(task.id) > TASK_TTL_MS) {
      task.subscribers.clear()
      tasks.delete(id)
      if (sessionIndex.get(task.sessionId) === id) {
        sessionIndex.delete(task.sessionId)
      }
    }
  }
}

function parseTimestamp(id: string): number {
  return parseInt(id.replace(/[^0-9]/g, ""), 36) || 0
}

export function createTask(
  streamId: string,
  sessionId: string,
  abortController: AbortController
): ActiveTask | null {
  const existing = sessionIndex.get(sessionId)
  if (existing) {
    const existingTask = tasks.get(existing)
    if (existingTask && !existingTask.completed) {
      return null
    }
    sessionIndex.delete(sessionId)
  }

  const task: ActiveTask = {
    id: streamId,
    sessionId,
    status: "streaming",
    content: "",
    errorMessage: null,
    messageId: null,
    subscribers: new Set(),
    abortController,
    completed: false,
  }

  tasks.set(streamId, task)
  sessionIndex.set(sessionId, streamId)

  return task
}

export function getTask(streamId: string): ActiveTask | undefined {
  return tasks.get(streamId)
}

export function getActiveTaskForSession(
  sessionId: string
): ActiveTask | undefined {
  const streamId = sessionIndex.get(sessionId)
  if (!streamId) return undefined
  const task = tasks.get(streamId)
  if (!task || task.completed) {
    sessionIndex.delete(sessionId)
    return undefined
  }
  return task
}

export function subscribe(streamId: string, subscriber: Subscriber): boolean {
  const task = tasks.get(streamId)
  if (!task) return false
  task.subscribers.add(subscriber)
  return true
}

export function unsubscribe(streamId: string, subscriber: Subscriber): void {
  const task = tasks.get(streamId)
  if (task) {
    task.subscribers.delete(subscriber)
  }
}

export function broadcast(task: ActiveTask, event: StreamEvent): void {
  for (const sub of task.subscribers) {
    try {
      sub(event)
    } catch {
      task.subscribers.delete(sub)
    }
  }
}

export function completeTask(streamId: string, messageId: number | null): void {
  const task = tasks.get(streamId)
  if (!task) return
  task.status = "completed"
  task.completed = true
  task.messageId = messageId
  task.subscribers.clear()
  setTimeout(cleanup, TASK_TTL_MS)
}

export function failTask(streamId: string, errorMessage: string): void {
  const task = tasks.get(streamId)
  if (!task) return
  task.status = "failed"
  task.completed = true
  task.errorMessage = errorMessage
  broadcast(task, { type: "error", message: errorMessage, streamId })
  task.subscribers.clear()
  setTimeout(cleanup, TASK_TTL_MS)
}

export function cancelTask(streamId: string): boolean {
  const task = tasks.get(streamId)
  if (!task || task.completed) return false
  task.status = "cancelled"
  task.completed = true
  task.abortController.abort()
  broadcast(task, { type: "cancelled", streamId })
  task.subscribers.clear()
  setTimeout(cleanup, TASK_TTL_MS)
  return true
}
