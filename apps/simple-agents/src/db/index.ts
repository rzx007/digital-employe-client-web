import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import path from "node:path"
import fs from "node:fs"
import * as schema from "./schema"
import { ensureDataDir, getMigrationsDir } from "../config"

let _db: ReturnType<typeof drizzle> | undefined

export function initDb() {
  if (_db) return

  const dataDir = ensureDataDir()
  const dbPath = path.join(dataDir, "simple-agents.db")

  const sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")

  _db = drizzle(sqlite, { schema })

  const migrationsDir = getMigrationsDir()
  if (fs.existsSync(migrationsDir)) {
    migrate(_db, { migrationsFolder: migrationsDir })
  }
}

export function getDb() {
  if (!_db) initDb()
  return _db!
}

export type Database = ReturnType<typeof getDb>
