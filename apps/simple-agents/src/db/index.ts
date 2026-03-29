import { Database as BunDatabase } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import path from "node:path"
import fs from "node:fs"
import * as schema from "./schema"

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data")

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const DB_PATH = path.join(DATA_DIR, "simple-agents.db")

const sqlite = new BunDatabase(DB_PATH, { create: true })

sqlite.exec("PRAGMA journal_mode = WAL")
sqlite.exec("PRAGMA foreign_keys = ON")

export const db = drizzle(sqlite, { schema })

const MIGRATIONS_DIR = path.join(import.meta.dir, "migrations")

if (fs.existsSync(MIGRATIONS_DIR)) {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
}

export { DATA_DIR, DB_PATH }
export type Database = typeof db
