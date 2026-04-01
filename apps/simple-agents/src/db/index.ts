import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import path from "node:path"
import fs from "node:fs"
import * as schema from "./schema"

let _dataDir: string | undefined
let _dbPath: string | undefined
let _db: ReturnType<typeof drizzle> | undefined
let _migrationsDir: string | undefined
let _staticDir: string | undefined
let _rootDir: string | undefined

function ensureInit() {
  if (_db) return
  initDb()
}

export function initDb(dataDir?: string, migrationsDir?: string) {
  if (_db) return

  _dataDir = dataDir || process.env.DATA_DIR || path.join(process.cwd(), "data")

  if (!fs.existsSync(_dataDir)) {
    fs.mkdirSync(_dataDir, { recursive: true })
  }

  _dbPath = path.join(_dataDir, "simple-agents.db")

  const sqlite = new Database(_dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")

  _db = drizzle(sqlite, { schema })

  _migrationsDir =
    migrationsDir ||
    process.env.MIGRATIONS_DIR ||
    path.join(getRootDir(), "migrations")

  if (fs.existsSync(_migrationsDir)) {
    migrate(_db, { migrationsFolder: _migrationsDir })
  }
}

export function getRootDir(): string {
  if (_rootDir) return _rootDir
  if (process.env.ROOT_DIR) {
    _rootDir = process.env.ROOT_DIR
    return _rootDir
  }
  return process.cwd()
}

export function setRootDir(dir: string): void {
  _rootDir = dir
}

export function setStaticDir(dir: string): void {
  _staticDir = dir
}

export function getStaticDir(): string {
  if (_staticDir) return _staticDir
  return path.join(getRootDir(), "static")
}

export function getMigrationsDir(): string {
  if (_migrationsDir) return _migrationsDir
  return path.join(getRootDir(), "migrations")
}

export { _rootDir as ROOT_DIR }

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
