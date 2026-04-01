import type { Hono } from "hono"

export declare function setup(dataDir?: string): Hono
export declare const app: Hono
export declare const DATA_DIR: string
export declare const SKIP_RESPONSE_WRAP: symbol
export declare const cronScheduler: {
  start: () => Promise<void>
  stop: () => void
}
