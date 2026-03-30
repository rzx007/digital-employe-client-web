import { agentRequest } from "@/lib/agent-request"
import type { AgentEmployee, ImportEmployeeResult } from "./types"

export async function fetchEmployees(): Promise<AgentEmployee[]> {
  return agentRequest<AgentEmployee[]>("/api/employees")
}

export async function fetchEmployeeById(
  employeeId: string
): Promise<AgentEmployee> {
  return agentRequest<AgentEmployee>(`/api/employees/${employeeId}`)
}

export async function deleteEmployee(employeeId: string) {
  return agentRequest<{ success: boolean }>(`/api/employees/${employeeId}`, {
    method: "DELETE",
  })
}

export async function importEmployee(
  userId: string
): Promise<ImportEmployeeResult> {
  return agentRequest<ImportEmployeeResult>(`/api/employees/import/${userId}`, {
    method: "POST",
  })
}
