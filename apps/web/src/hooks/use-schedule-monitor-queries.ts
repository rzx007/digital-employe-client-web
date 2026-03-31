import { useQuery } from "@tanstack/react-query"
import { chatKeys } from "@/lib/query-keys/chat"
import {
  generateAnomalies,
  generateMonthlyOverview,
  generateTaskSummary,
  generateTodayTaskRuns,
} from "@/lib/mock-data/schedule-monitor"

export function useMonthlyScheduleOverview(
  employeeId: string | null,
  year: number,
  month: number
) {
  return useQuery({
    queryKey: [...chatKeys.all, "schedule-overview", employeeId, year, month],
    queryFn: () => generateMonthlyOverview(employeeId!, year, month),
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  })
}

export function useTodayTaskRuns(employeeId: string | null) {
  return useQuery({
    queryKey: [...chatKeys.all, "today-task-runs", employeeId],
    queryFn: () => generateTodayTaskRuns(employeeId!),
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  })
}

export function useTaskSummary(employeeId: string | null) {
  return useQuery({
    queryKey: [...chatKeys.all, "task-summary", employeeId],
    queryFn: () => generateTaskSummary(employeeId!),
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  })
}

export function useAnomalies(employeeId: string | null) {
  return useQuery({
    queryKey: [...chatKeys.all, "anomalies", employeeId],
    queryFn: () => generateAnomalies(employeeId!),
    enabled: Boolean(employeeId),
    staleTime: 30_000,
  })
}
