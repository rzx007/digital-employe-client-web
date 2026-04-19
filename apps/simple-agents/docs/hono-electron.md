
## 改造方案：Electron + Hono 合并 + electron-forge

### 目标结构

```
apps/
  web/                          # 纯 Web React SPA（无 Electron 代码）
  desktop/                      # 新包：Electron + Hono 合并
    src/
      main.ts                   # Electron 主进程
      preload.ts                # Preload（暴露 electronApi + 服务端地址）
      server/                   # ← 从 simple-agents/src/ 搬入
        app.ts
        routes/
        middleware/
        db/
        services/
        cron/
        ...
    migrations/                 # ← 从 simple-agents/migrations/ 搬入
    static/                     # ← 从 simple-agents/static/ 搬入
    vite.base.config.ts         # 共享 Vite 工具函数
    vite.main.config.ts         # 主进程构建
    vite.preload.config.ts      # Preload 构建
    forge.config.ts             # Electron Forge 配置（无 renderer plugin）
    drizzle.config.ts
    package.json
packages/
  ui/                           # 不变
```

### 开发流程

- **dev 模式**: 同时启动 `web dev server`（端口 3399）+ `desktop`（Electron 加载 localhost:3399），`Hono` 在主进程 localhost:3005
- **build 模式**: 先 `turbo build --filter=web` → 得到 `apps/web/dist/`，然后 `desktop` 的 Electron 加载 `web/dist/index.html`

### 分步实施计划

| 步骤 | 内容 | 关键点 |
|------|------|--------|
| **1. 创建 desktop 包骨架** | 初始化 `apps/desktop/`，`package.json`，安装 `electron-forge` 依赖 | `@electron-forge/cli`, `@electron-forge/plugin-vite`, `makers` |
| **2. 搬入 Hono 服务器代码** | `simple-agents/src/` → `desktop/src/server/`；`migrations/`、`static/` → `desktop/` | 修复 `import` 路径，修复 `findPackageRoot` 改为基于 `__dirname`/`process.resourcesPath` |
| **3. 编写 Electron 主进程** | 基于 `web/electron/main/index.ts`，去掉对 `simple-agents` 的 `workspace import`，直接 `import` 同包的 `server/app` | `Hono` 用 `@hono/node-server` 在 localhost:3005 启动 |
| **4. 编写 Preload 脚本** | `contextBridge.exposeInMainWorld('electronApi', { getServerUrl, quitApp, ... })` | 暴露服务端 `URL`，让 `renderer` 知道 `API` 地址 |
| **5. 配置 electron-forge** | `forge.config.ts`：只有 `main` + `preload` 两个 `build target`，无 `renderer plugin`；`packagerConfig` 包含 `web/dist/` | `extraResource` 指向 `../web/dist/` |
| **6. 编写 Vite configs** | `vite.base.config.ts`（参考 `electron-hono-main`）、`vite.main.config.ts`（`CJS` 输出，`external deps`）、`vite.preload.config.ts`（`CJS` + `inlineDynamicImports`） | 所有 `dependencies` `external`，`better-sqlite3` 原生模块不打包 |
| **7. 修复 Renderer API 地址** | `agent-request.ts` 和 `chat-conversation-view.tsx`：根据 `window.electronApi?.getServerUrl()` 动态设置 `baseURL`，`fallback` 到 `/simple-agents`（`web` 模式走 `proxy`） | 这是当前生产环境 `API` 调用失败的根因 |
| **8. 修复 DB 路径** | `src/config.ts`：`Electron` 环境用 `app.getPath('userData')` 作为 `dataDir`；`resourcesDir` 指向包含 `migrations/` 和 `static/` 的目录 | `setup({ dataDir, resourcesDir })` |
| **9. 构建流水线** | `turbo.json` 增加 `desktop` 构建 `task`，`dependsOn: ["^build"]` 确保 `web` 先构建；`desktop` 的 `package` 命令组合 `web build` + `forge make` | `pnpm-workspace.yaml` 加入 `apps/desktop` |
| **10. 清理 web 包** | 移除 `web/electron/` 目录、移除 `vite-plugin-electron`、移除 `electron-builder` 依赖、移除 `mode=electron` 逻辑 | `web` 变为纯 `Web` 包 |

### 核心代码变更

**1. `desktop/src/main.ts`（Electron 主进程）**
```typescript
import { app, BrowserWindow } from "electron"
import { serve } from "@hono/node-server"
import { setup } from "./server/app"

// 启动 Hono
const agentApp = setup({ dataDir: app.getPath("userData") + "/agent-data", resourcesDir })
serve({ fetch: agentApp.fetch, port: 3005 })

// 加载 renderer
function createWindow() {
  const win = new BrowserWindow({
    webPreferences: { preload: path.join(__dirname, "preload.js") }
  })
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL) // dev: web dev server
  } else {
    win.loadFile(path.join(__dirname, "../../web/dist/index.html")) // prod: web build
  }
}
```

**2. `desktop/src/preload.ts`（暴露 API 地址）**
```typescript
contextBridge.exposeInMainWorld("electronApi", {
  getServerUrl: () => "http://localhost:3005",
  quitApp: () => ipcRenderer.invoke("quit-app"),
  // ... 其他 window 控制方法
})
```

**3. `web/src/lib/agent-request.ts`（修复 URL）**
```typescript
const isElectron = !!window.electronApi
const SIMPLE_AGENTS_BASE = isElectron
  ? window.electronApi.getServerUrl()
  : "/simple-agents"
```

**4. `forge.config.ts`（无 renderer plugin）**
```typescript
new VitePlugin({
  build: [
    { entry: "src/main.ts", config: "vite.main.config.ts" },
    { entry: "src/preload.ts", config: "vite.preload.config.ts" },
  ],
  // 没有 renderer — 使用预构建的 web dist
})
```

### 预估改动量

| 区域 | 文件数 | 难度 |
|------|--------|------|
| 创建 `desktop` 包（新文件） | ~15 | 中 |
| 搬迁 `simple-agents` 代码 | ~20 | 低（改 `import` 路径） |
| 修改 `web` 包（清理 + 修复 `URL`） | ~5 | 低 |
| 构建配置 | ~5 | 中 |
| **总计** | ~45 文件 | |

### 风险点

1. **`better-sqlite3` 原生模块打包**：`electron-forge` 需要正确 `rebuild`，配置 `rebuildConfig`
2. **SSE 流式通信**：保持 `HTTP localhost` 方式，无需额外处理
3. **`web dist` 路径**：打包时需确认 `web/dist/` 被正确包含，可能需要 `extraResources` 或 `symlink`
4. **DB `migrations` 路径**：`Electron` 打包后 `resources` 目录结构变化

---