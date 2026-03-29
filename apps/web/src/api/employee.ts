import { ofetch } from "ofetch"
import type { AgentEmployee, ImportEmployeeResult } from "./types"

const SIMPLE_AGENTS_BASE = "/simple-agents/api"

const agentRequest = ofetch.create({
  baseURL: SIMPLE_AGENTS_BASE,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
})

export async function fetchEmployees(): Promise<AgentEmployee[]> {
  return agentRequest<AgentEmployee[]>("/employees")
}

export async function fetchEmployeeById(
  employeeId: string
): Promise<AgentEmployee> {
  return agentRequest<AgentEmployee>(`/employees/${employeeId}`)
}

export async function deleteEmployee(employeeId: string) {
  return agentRequest<{ success: boolean }>(`/employees/${employeeId}`, {
    method: "DELETE",
  })
}

export async function importEmployee(
  userId: string
): Promise<ImportEmployeeResult> {
  return agentRequest<ImportEmployeeResult>(`/employees/import/${userId}`, {
    method: "POST",
  })
}
