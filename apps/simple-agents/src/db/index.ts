import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import path from "node:path"
import fs from "node:fs"
import * as schema from "./schema"

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data")

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const DB_PATH = path.join(DATA_DIR, "simple-agents.db")

const sqlite = new Database(DB_PATH)

sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")

export const db = drizzle(sqlite, { schema })

const MIGRATIONS_DIR = path.join(__dirname, "migrations")

if (fs.existsSync(MIGRATIONS_DIR)) {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
}

export { DATA_DIR, DB_PATH }
export type Database = typeof db
