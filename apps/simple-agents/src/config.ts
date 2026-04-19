import path from "node:path"
import fs from "node:fs"

// ---- 目录结构 ----
// RESOURCES_DIR/ → 只读资源根目录，包含 migrations/、static/ 等
//   ├── migrations/    (drizzle SQL 迁移文件)
//   └── static/        (skills.zip 等静态资源)
//
// DATA_DIR/   → 运行时数据目录，存放数据库、workspace、skills 等
//   ├── simple-agents.db
//   ├── skills/
//   ├── employees/
//   └── workspace/

let _dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data")
let _resourcesDir: string | undefined

export interface SetupOptions {
  dataDir?: string
  resourcesDir?: string
}

export function configureDirs(options: SetupOptions) {
  if (options.dataDir) _dataDir = options.dataDir
  if (options.resourcesDir) _resourcesDir = options.resourcesDir
}

export function ensureDataDir(): string {
  if (!fs.existsSync(_dataDir)) {
    fs.mkdirSync(_dataDir, { recursive: true })
  }
  return _dataDir
}

export function getDataDir() {
  return _dataDir
}

export function getResourcesDir() {
  return _resourcesDir ?? process.cwd()
}

export function getStaticDir() {
  return path.join(getResourcesDir(), "static")
}

export function getMigrationsDir() {
  return path.join(getResourcesDir(), "migrations")
}
