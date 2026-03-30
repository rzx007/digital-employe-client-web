import { agentRequest } from "@/lib/agent-request"
import type { AgentSession, AgentMessage } from "./types"

export async function createSession(
  title?: string,
  employeeId?: string
): Promise<AgentSession> {
  return agentRequest<AgentSession>("/api/sessions", {
    method: "POST",
    body: { title, employeeId },
  })
}

export async function fetchSessions(
  employeeId?: string
): Promise<AgentSession[]> {
  return agentRequest<AgentSession[]>("/api/sessions", {
    params: employeeId ? { employeeId } : undefined,
  })
}

export async function fetchSessionMessages(
  sessionId: string
): Promise<AgentMessage[]> {
  return agentRequest<AgentMessage[]>(`/api/sessions/${sessionId}/messages`)
}

export async function deleteSession(
  sessionId: string
): Promise<{ success: boolean }> {
  return agentRequest<{ success: boolean }>(`/api/sessions/${sessionId}`, {
    method: "DELETE",
  })
}
