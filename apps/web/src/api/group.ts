import { agentRequest } from "@/lib/agent-request"
import type { AgentGroup } from "./types"

export interface CreateGroupParams {
  name: string
  employeeIds: string[]
}

export interface UpdateGroupParams {
  name?: string
  employeeIds?: string[]
}

export async function fetchGroups(): Promise<AgentGroup[]> {
  return agentRequest<AgentGroup[]>("/api/groups")
}

export async function fetchGroupById(groupId: string): Promise<AgentGroup> {
  return agentRequest<AgentGroup>(`/api/groups/${groupId}`)
}

export async function createGroup(
  params: CreateGroupParams
): Promise<AgentGroup> {
  return agentRequest<AgentGroup>("/api/groups", {
    method: "POST",
    body: params,
  })
}

export async function updateGroup(
  groupId: string,
  params: UpdateGroupParams
): Promise<AgentGroup> {
  return agentRequest<AgentGroup>(`/api/groups/${groupId}`, {
    method: "PATCH",
    body: params,
  })
}

export async function deleteGroup(groupId: string) {
  return agentRequest<{ success: boolean }>(`/api/groups/${groupId}`, {
    method: "DELETE",
  })
}
