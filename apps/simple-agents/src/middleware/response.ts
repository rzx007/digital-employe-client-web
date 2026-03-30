import { createMiddleware } from "hono/factory"

export interface ApiResponse<T = any> {
  code: number
  data: T
  status: number
  message: string
}

export const SKIP_RESPONSE_WRAP = "skipResponseWrap" as const
export type SkipResponseWrap = typeof SKIP_RESPONSE_WRAP

declare module "hono" {
  interface ContextVariableMap {
    [SKIP_RESPONSE_WRAP]: boolean
  }
}

export const unifiedResponse = createMiddleware(async (c, next) => {
  const originalJson = c.json as (...args: any[]) => Response

  c.json = ((body: unknown, ...args: any[]) => {
    if (c.get(SKIP_RESPONSE_WRAP)) {
      return originalJson(body, ...args)
    }

    if (
      body &&
      typeof body === "object" &&
      "code" in body &&
      "data" in body &&
      "status" in body &&
      "message" in body
    ) {
      return originalJson(body, ...args)
    }

    let httpStatus: number = 200
    if (args.length > 0 && typeof args[0] === "number") {
      httpStatus = args[0]
    } else if (
      args.length > 0 &&
      args[0] &&
      typeof args[0] === "object" &&
      "status" in args[0]
    ) {
      httpStatus = args[0].status as number
    }

    if (httpStatus >= 400 && body && typeof body === "object") {
      const bodyObj = body as Record<string, unknown>
      const errorMessage = String(bodyObj?.message || bodyObj?.error || "")
      const { error, message, ...rest } = bodyObj
      const wrapped: ApiResponse = {
        code: 0,
        data: Object.keys(rest).length > 0 ? rest : null,
        status: httpStatus,
        message: errorMessage,
      }
      return originalJson(wrapped, ...args)
    }

    const wrapped: ApiResponse<typeof body> = {
      code: 1,
      data: body,
      status: httpStatus,
      message: "",
    }
    return originalJson(wrapped, ...args)
  }) as typeof c.json

  await next()
})
