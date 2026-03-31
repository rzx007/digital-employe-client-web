import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "url"
import { dirname } from "path"
import * as schema from "./schema"

function findPackageRoot(startDir: string): string {
  let dir = startDir
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(dir, "package.json"), "utf-8")
        )
        if (pkg.name === "simple-agents") return dir
      } catch {
        // continue walking up
      }
    }
    dir = path.dirname(dir)
  }
  return startDir
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = findPackageRoot(__dirname)

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, "data")
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const DB_PATH = path.join(DATA_DIR, "simple-agents.db")

const sqlite = new Database(DB_PATH)
sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")

export const db = drizzle(sqlite, { schema })

const MIGRATIONS_DIR = path.join(ROOT_DIR, "migrations")

if (fs.existsSync(MIGRATIONS_DIR)) {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
}

export { ROOT_DIR, DATA_DIR, DB_PATH }
export type Database = typeof db
