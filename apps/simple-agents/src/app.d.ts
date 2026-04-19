import type { Hono } from "hono"

export interface SetupOptions {
  dataDir?: string
  resourcesDir?: string
}

export declare function setup(options?: SetupOptions): Hono
export declare const app: Hono
export declare const SKIP_RESPONSE_WRAP: symbol
export declare const cronScheduler: {
  start: () => Promise<void>
  stop: () => void
}
