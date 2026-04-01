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
      } catch (_e) {
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

let _dataDir: string | undefined
let _dbPath: string | undefined
let _db: ReturnType<typeof drizzle> | undefined

function ensureInit() {
  if (_db) return
  initDb()
}

export function initDb(dataDir?: string) {
  if (_db) return

  _dataDir = dataDir || process.env.DATA_DIR || path.join(ROOT_DIR, "data")
  console.log(`[Simple Agents] Data dir: ${_dataDir}`)

  if (!fs.existsSync(_dataDir)) {
    fs.mkdirSync(_dataDir, { recursive: true })
  }

  _dbPath = path.join(_dataDir, "simple-agents.db")

  const sqlite = new Database(_dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")

  _db = drizzle(sqlite, { schema })

  const MIGRATIONS_DIR = path.join(ROOT_DIR, "migrations")

  if (fs.existsSync(MIGRATIONS_DIR)) {
    migrate(_db, { migrationsFolder: MIGRATIONS_DIR })
  }
}

export { ROOT_DIR }

export function getDb() {
  ensureInit()
  return _db!
}

export function getDataDir(): string {
  ensureInit()
  return _dataDir!
}

export function getDbPath(): string {
  ensureInit()
  return _dbPath!
}

export type Database = ReturnType<typeof getDb>
