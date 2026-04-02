import { ofetch } from "ofetch"
import type { AgentApiResponse } from "@/api/types"

const SIMPLE_AGENTS_BASE = import.meta.env.DEV
  ? "/simple-agents"
  : "http://localhost:3005"

export const agentRequest = ofetch.create({
  baseURL: SIMPLE_AGENTS_BASE,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  async onResponse({ response }) {
    const contentType = response.headers.get("content-type") || ""
    if (!contentType.includes("application/json")) return

    const data = response._data
    if (
      data &&
      typeof data === "object" &&
      "code" in data &&
      "data" in data &&
      "status" in data &&
      "message" in data
    ) {
      const wrapped = data as AgentApiResponse<unknown>
      if (wrapped.code === 0) {
        throw new Error(wrapped.message || `Request failed (${wrapped.status})`)
      }
      response._data = wrapped.data
    }
  },
})
