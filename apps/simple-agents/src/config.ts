import path from "node:path"
import fs from "node:fs"

// ---- 目录结构 ----
// ROOT_DIR/   → 项目根目录（源码所在），用于定位 migrations/、static/ 等只读资源
// DATA_DIR/   → 运行时数据目录，存放数据库、workspace、skills 等
//   ├── simple-agents.db
//   ├── skills/
//   ├── employees/
//   └── workspace/

let _rootDir = process.env.ROOT_DIR || process.cwd()
let _dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data")
let _staticDir: string | undefined
let _migrationsDir: string | undefined

export interface SetupOptions {
  rootDir?: string
  dataDir?: string
  staticDir?: string
  migrationsDir?: string
}

export function configureDirs(options: SetupOptions) {
  if (options.rootDir) _rootDir = options.rootDir
  if (options.dataDir) _dataDir = options.dataDir
  if (options.staticDir) _staticDir = options.staticDir
  if (options.migrationsDir) _migrationsDir = options.migrationsDir
}

export function ensureDataDir(): string {
  if (!fs.existsSync(_dataDir)) {
    fs.mkdirSync(_dataDir, { recursive: true })
  }
  return _dataDir
}

export function getRootDir() {
  return _rootDir
}

export function getDataDir() {
  return _dataDir
}

export function getStaticDir() {
  return _staticDir ?? path.join(_rootDir, "static")
}

export function getMigrationsDir() {
  return _migrationsDir ?? path.join(_rootDir, "migrations")
}
