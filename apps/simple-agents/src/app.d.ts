import type { Hono } from "hono"

export interface SetupOptions {
  rootDir?: string
  dataDir?: string
  staticDir?: string
  migrationsDir?: string
}

export declare function setup(options?: SetupOptions): Hono
export declare const app: Hono
export declare const getDataDir: () => string
export declare const DATA_DIR: string
export declare const SKIP_RESPONSE_WRAP: symbol
export declare const cronScheduler: {
  start: () => Promise<void>
  stop: () => void
}
