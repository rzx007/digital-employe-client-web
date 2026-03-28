# Electron vs Tauri vs Electrobun 深度对比

> 面向桌面应用开发者的框架选型参考，涵盖架构、性能、API、生态、安全等维度

---

## 一、框架概览

| 维度         | Electron                                 | Tauri                        | Electrobun              |
| ------------ | ---------------------------------------- | ---------------------------- | ----------------------- |
| 首次发布     | 2013 年                                  | 2019 年 (v1) / 2024 年 (v2)  | 2024 年 (v1)            |
| 开发者       | GitHub + OpenJS 基金会                   | Tauri 社区                   | Blackboard              |
| 核心语言     | JavaScript / TypeScript                  | Rust + JavaScript/TypeScript | TypeScript              |
| 后端运行时   | Node.js + V8                             | Rust (编译为原生二进制)      | Bun                     |
| 渲染引擎     | Chromium (内置)                          | 系统 WebView                 | 系统 WebView + 可选 CEF |
| 开源协议     | MIT                                      | MIT / Apache-2.0             | -                       |
| GitHub Stars | ~115k+                                   | ~90k+                        | 较少 (新项目)           |
| 知名应用     | VS Code, Discord, Slack, Notion, ChatGPT | -                            | -                       |

---

## 二、架构对比

### 2.1 进程模型

```
┌─────────────────── Electron ───────────────────┐
│                                                 │
│  ┌─────────────┐    ┌──────────────────────┐   │
│  │  Main Process │    │  Renderer Process     │   │
│  │  (Node.js)   │    │  (Chromium + V8)     │   │
│  │             │◄──►│                      │   │
│  │  - 窗口管理  │IPC │  - UI 渲染            │   │
│  │  - 系统API   │    │  - Web 标准           │   │
│  │  - 生命周期  │    │                      │   │
│  └─────────────┘    └──────────────────────┘   │
│           │                                     │
│  ┌─────────────┐                               │
│  │ Preload     │                               │
│  │ (contextBridge)                             │
│  └─────────────┘                               │
│  + UtilityProcess (可选子进程)                    │
└─────────────────────────────────────────────────┘

┌─────────────────── Tauri ──────────────────────┐
│                                                 │
│  ┌─────────────────┐    ┌──────────────────┐   │
│  │ Core (Rust)     │    │  WebView         │   │
│  │                 │    │  (系统原生)        │   │
│  │  - 窗口 (TAO)   │◄──►│  - UI 渲染        │   │
│  │  - WebView(WRY)│IPC │  - Web 标准        │   │
│  │  - 系统API     │    │                  │   │
│  │  - Commands    │    │  invoke()        │   │
│  └─────────────────┘    └──────────────────┘   │
│                                                 │
│  + Sidecar (可选外部进程)                        │
└─────────────────────────────────────────────────┘

┌─────────────── Electrobun ─────────────────────┐
│                                                 │
│  ┌─────────────────┐    ┌──────────────────┐   │
│  │ Bun 主进程       │    │  Browser Views   │   │
│  │ (Web Worker)     │    │  (系统 WebView)   │   │
│  │                 │◄──►│                  │   │
│  │  - 窗口管理      │RPC │  - UI 渲染        │   │
│  │  - 系统API(FFI) │    │  - Web 标准       │   │
│  │  - 事件系统      │    │  - Electroview   │   │
│  └───────┬─────────┘    └──────────────────┘   │
│          │ FFI                                 │
│  ┌───────▼─────────┐                           │
│  │ Native Wrapper   │                           │
│  │ (Zig/C++/ObjC)   │                           │
│  └─────────────────┘                           │
└─────────────────────────────────────────────────┘
```

### 2.2 架构设计差异

| 设计要点          | Electron                       | Tauri                  | Electrobun                             |
| ----------------- | ------------------------------ | ---------------------- | -------------------------------------- |
| 进程通信          | IPC (ipcMain/ipcRenderer)      | invoke() + 事件        | 类型安全 RPC                           |
| 通信类型安全      | 手动定义                       | 通过宏自动生成         | 共享 TS 类型，端到端安全               |
| 渲染进程隔离      | Context Isolation + Preload    | CSP + 权限系统         | 沙箱模式 + Partition                   |
| 多窗口/多 Webview | BrowserWindow + BrowserView    | 多窗口 + WebviewWindow | BrowserWindow + `<electrobun-webview>` |
| 原生代码交互      | Node.js N-API / native modules | Rust FFI + 插件        | Bun FFI + 原生绑定                     |
| 后端逻辑语言      | Node.js (JS/TS)                | Rust (必需)            | Bun (TS only)                          |

### 2.3 IPC 通信代码对比

**Electron:**

```javascript
// 主进程
const { ipcMain } = require("electron")
ipcMain.handle("read-file", async (event, path) => {
  return fs.readFileSync(path, "utf-8")
})

// Preload
const { contextBridge, ipcRenderer } = require("electron")
contextBridge.exposeInMainWorld("api", {
  readFile: (path) => ipcRenderer.invoke("read-file", path),
})

// 渲染进程
const content = await window.api.readFile("/path/to/file")
```

**Tauri:**

```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri")
}
```

```javascript
// 前端
import { invoke } from "@tauri-apps/api/core"
const content = await invoke("read_file", { path: "/path/to/file" })
```

**Electrobun:**

```typescript
// src/shared/types.ts
export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      readFile: { params: { path: string }; response: string }
    }
    messages: {}
  }>
  webview: RPCSchema<{ requests: {}; messages: {} }>
}

// src/bun/index.ts (主进程)
const rpc = BrowserView.defineRPC<AppRPC>({
  handlers: {
    requests: {
      readFile: ({ path }) => fs.readFileSync(path, "utf-8"),
    },
  },
})

// src/view/index.ts (浏览器进程)
const electroview = new Electroview({ rpc })
const content = await electroview.rpc.request.readFile({
  path: "/path/to/file",
})
// 类型完全自动推导，无需手动定义参数
```

**IPC 对比总结：**

- Electron：需要手动在 preload 中桥接，无类型安全
- Tauri：Rust 宏自动生成桥接，前端 invoke 通过字符串调用
- Electrobun：共享 TS 类型，端到端类型安全，自动推导参数和返回值

---

## 三、性能对比

### 3.1 核心指标

| 指标         | Electron  | Tauri                   | Electrobun            |
| ------------ | --------- | ----------------------- | --------------------- |
| 空应用安装包 | ~80-150MB | ~2-10MB                 | ~14MB (含 Bun 运行时) |
| 压缩分发包   | ~80-100MB | ~600KB-3MB              | ~13MB (ZSTD 自解压)   |
| 冷启动时间   | 2-5 秒    | 300-500ms               | <50ms                 |
| 空闲内存占用 | 100-200MB | 30-50MB                 | 15-30MB               |
| 更新包大小   | 50-100MB  | 5-10MB                  | **~14KB** (BSDIFF)    |
| JS 启动性能  | V8 (中等) | WebView JS (取决于引擎) | Bun (极快)            |

### 3.2 体积构成分析

```
Electron (~150MB):
├── Chromium (~120MB)     ← 最大开销
├── Node.js (~20MB)
├── Electron 框架 (~10MB)
└── 你的应用代码 + 资源

Tauri (~2-10MB):
├── Rust 二进制 (~2-5MB)
├── WebView (系统自带，不计入)
└── 你的前端代码 + 资源

Electrobun (~14MB):
├── Bun 运行时 (~10MB)
├── 原生绑定 (~1MB)
├── Launcher (~1MB)
├── 你的应用代码 + 资源
└── WebView (系统自带，默认不计入)
    └── CEF (可选, +100MB)
```

### 3.3 性能测试场景

| 场景         | Electron             | Tauri                    | Electrobun                     |
| ------------ | -------------------- | ------------------------ | ------------------------------ |
| 首次启动     | 慢 (需加载 Chromium) | 快 (原生启动 + WebView)  | 极快 (Zig 启动器 + Bun)        |
| 热更新开发   | 快 (HMR)             | 中 (Rust 编译)           | 快 (Bun 极速编译)              |
| CPU 密集任务 | 主进程 (Node.js)     | Rust 原生 (极快)         | Bun (快，接近原生)             |
| 内存密集任务 | 较高 (V8 + Chromium) | 低 (Rust + 系统 WebView) | 中低 (Bun + 系统 WebView)      |
| GPU/3D 渲染  | 极好 (Chromium)      | 好 (取决于系统 WebView)  | 好 (系统 WebView) / 极好 (CEF) |
| 渲染一致性   | 极好 (自带 Chromium) | 差 (依赖系统 WebView)    | 中 (默认系统) / 极好 (CEF)     |

---

## 四、平台支持

### 4.1 桌面平台

| 平台                  | Electron | Tauri    | Electrobun    |
| --------------------- | -------- | -------- | ------------- |
| macOS (Intel)         | 完整支持 | 完整支持 | 完整支持      |
| macOS (Apple Silicon) | 完整支持 | 完整支持 | 完整支持      |
| Windows (x64)         | 完整支持 | 完整支持 | 完整支持      |
| Windows (ARM64)       | 完整支持 | 完整支持 | 通过 x64 模拟 |
| Linux (x64)           | 完整支持 | 完整支持 | 完整支持      |
| Linux (ARM64)         | 完整支持 | 完整支持 | 完整支持      |

### 4.2 移动平台

| 平台    | Electron | Tauri     | Electrobun |
| ------- | -------- | --------- | ---------- |
| iOS     | 不支持   | 支持 (v2) | 不支持     |
| Android | 不支持   | 支持 (v2) | 不支持     |

### 4.3 构建平台

| 平台         | Electron                | Tauri                  | Electrobun             |
| ------------ | ----------------------- | ---------------------- | ---------------------- |
| macOS 构建   | 支持                    | 支持                   | 支持                   |
| Windows 构建 | 支持                    | 支持                   | 支持                   |
| Linux 构建   | 支持                    | 支持                   | 支持                   |
| 跨平台构建   | 支持 (electron-builder) | 需 CI (GitHub Actions) | 需 CI (GitHub Actions) |

### 4.4 WebView 引擎

| 平台    | Electron      | Tauri                 | Electrobun                    |
| ------- | ------------- | --------------------- | ----------------------------- |
| macOS   | 内置 Chromium | WKWebView (系统)      | WKWebView (系统) + CEF (可选) |
| Windows | 内置 Chromium | WebView2 (Edge, 系统) | WebView2 (系统) + CEF (可选)  |
| Linux   | 内置 Chromium | WebKitGTK (系统)      | WebKitGTK (系统) + CEF (可选) |

**渲染一致性问题：**

- **Electron**：自带 Chromium，所有平台渲染完全一致。这也是 Electron 体积大的根本原因
- **Tauri**：依赖系统 WebView，不同平台/版本可能存在渲染差异。这是 Tauri 体积小的根本原因
- **Electrobun**：默认使用系统 WebView（同 Tauri），但提供 CEF 可选方案。开发者可以在需要一致性和需要小体积之间灵活选择

---

## 五、API 与功能对比

### 5.1 核心 API 覆盖

| 功能              | Electron                         | Tauri                     | Electrobun                     |
| ----------------- | -------------------------------- | ------------------------- | ------------------------------ |
| 窗口创建/管理     | `BrowserWindow` (极全)           | `Window`                  | `BrowserWindow`                |
| 自定义标题栏      | frameless + 自定义               | `decorations: false`      | `titleBarStyle: "hidden"`      |
| 系统托盘          | `Tray`                           | `TrayIcon` (插件)         | `Tray`                         |
| 应用菜单          | `Menu`                           | `Menu` (插件)             | `ApplicationMenu`              |
| 右键菜单          | `Menu.popup`                     | `ContextMenu` (插件)      | `ContextMenu`                  |
| 原生通知          | `Notification`                   | `Notification` (插件)     | `Utils.showNotification`       |
| 文件对话框        | `dialog`                         | `Dialog` (插件)           | `Utils.openFileDialog`         |
| 消息框            | `dialog.showMessageBox`          | `Dialog` (插件)           | `Utils.showMessageBox`         |
| 剪贴板            | `clipboard`                      | `Clipboard` (插件)        | `Utils.clipboard*`             |
| 全局快捷键        | `globalShortcut`                 | `GlobalShortcut` (插件)   | `GlobalShortcut`               |
| 屏幕信息          | `screen`                         | 内置                      | `Screen`                       |
| 深链接            | `app.setAsDefaultProtocolClient` | `Deep Linking` (插件)     | `urlSchemes` 配置 (仅 macOS)   |
| 自动更新          | `autoUpdater` (需第三方)         | `Updater` (插件)          | 内置 BSDIFF 更新               |
| 多 Webview        | `<webview>` / BrowserView        | WebviewWindow             | `<electrobun-webview>` (OOPIF) |
| 文件系统          | Node.js `fs` (完整)              | `fs` 插件 (受限)          | Bun `fs` (完整)                |
| 网络请求          | Node.js `http` / Chromium        | `http` 插件               | Bun `fetch`                    |
| Shell 命令        | `shell` (受限)                   | `Shell` (插件, 受限)      | Bun 原生支持                   |
| 本地存储          | localStorage / IndexedDB         | localStorage / Store 插件 | localStorage / IndexedDB       |
| Cookie/Session    | `session`                        | HTTP 插件                 | `Session` (完整)               |
| 进程间通信        | IPC (完整)                       | invoke (完整)             | RPC (类型安全)                 |
| 代码签名          | 需工具链                         | 内置                      | 内置                           |
| 应用公证          | 需工具链                         | 需工具链                  | 内置                           |
| WebGPU            | Chromium 内置                    | 取决于系统 WebView        | 内置 + `<electrobun-wgpu>`     |
| 透明窗口          | 支持                             | 支持                      | 支持                           |
| 无边框窗口        | 支持                             | 支持                      | 支持                           |
| Dock 隐藏 (macOS) | `app.dock.hide()`                | 不内置                    | `Utils.setDockIconVisible`     |

### 5.2 API 设计理念对比

| 方面         | Electron               | Tauri               | Electrobun               |
| ------------ | ---------------------- | ------------------- | ------------------------ |
| 设计哲学     | 尽可能暴露能力         | 最小权限原则        | 平衡能力与简洁           |
| Node.js 访问 | 完整 (主进程)          | 不支持 (需 Sidecar) | 完整 (Bun 兼容大部分)    |
| npm 包兼容   | 完全兼容               | 有限 (仅前端)       | 大部分兼容 (Bun runtime) |
| 权限系统     | 手动控制               | 内置 ACL 权限系统   | 沙箱模式 + Partition     |
| 原生模块     | N-API / node-addon     | Rust FFI / 插件     | Bun FFI                  |
| 插件生态     | npm + electron-builder | 官方插件 + 社区     | 内置为主                 |

---

## 六、安全对比

### 6.1 安全模型

| 安全维度     | Electron                    | Tauri                      | Electrobun                |
| ------------ | --------------------------- | -------------------------- | ------------------------- |
| 上下文隔离   | `contextIsolation` (默认开) | 进程隔离 (Core vs WebView) | 沙箱模式                  |
| 预加载脚本   | Preload + contextBridge     | 脚本注入                   | Preload script            |
| Node.js 集成 | 可关闭 `nodeIntegration`    | 不集成                     | Bun 进程隔离              |
| CSP 策略     | 手动配置                    | 默认启用 + 可配置          | 自定义 `views://` schema  |
| 权限控制     | 手动                        | 内置 ACL + Capabilities    | Partition 隔离 + RPC 控制 |
| 远程内容     | 可加载任意 URL              | 受 CSP 约束                | 沙箱模式阻止 RPC          |
| 安全审计     | 定期 Chromium 审计          | 定期独立审计               | -                         |
| 原生模块安全 | 取决于模块                  | Rust 内存安全              | 取决于绑定                |

### 6.2 代码签名与分发安全

| 方面       | Electron                               | Tauri                    | Electrobun              |
| ---------- | -------------------------------------- | ------------------------ | ----------------------- |
| 代码签名   | 需外部工具 (electron-builder/codesign) | CI 集成 (GitHub Actions) | 内置 CLI 自动签名       |
| macOS 公证 | 需配置 notarytool                      | 需配置                   | 内置自动公证            |
| 更新安全   | 第三方 (electron-updater)              | 内置签名验证             | 内置 hash 验证 + BSDIFF |
| ASAR 打包  | 支持                                   | 不适用                   | 支持                    |

---

## 七、开发体验对比

### 7.1 项目初始化

**Electron:**

```bash
npm create electron-app my-app
# 或使用 electron-forge
npx create-electron-app my-app
```

**Tauri:**

```bash
npm create tauri-app@latest
# 或
cargo create-tauri-app
```

**Electrobun:**

```bash
bunx electrobun init
# 或手动
mkdir my-app && cd my-app && bun init . && bun install electrobun
```

### 7.2 开发工作流

| 方面            | Electron                   | Tauri                        | Electrobun               |
| --------------- | -------------------------- | ---------------------------- | ------------------------ |
| 热更新 (HMR)    | 快 (webpack/vite)          | 中 (前端快, Rust 需重编译)   | 快 (Bun 极速编译)        |
| DevTools        | Chromium DevTools (完整)   | 系统 WebView DevTools (有限) | WebKit/WebView2 DevTools |
| 调试主进程      | VS Code / Chrome DevTools  | VS Code + Rust 调试器        | 终端输出 (dev 模式)      |
| TypeScript 支持 | 完整                       | 完整                         | 完整 (内置)              |
| 前端框架        | 任意 (React/Vue/Svelte 等) | 任意 (官方模板丰富)          | 任意                     |
| 后端语言        | JavaScript/TypeScript      | **Rust (必需)**              | TypeScript (only)        |
| 学习曲线        | 低 (JS 开发者)             | 高 (需学 Rust)               | 低 (TS 开发者)           |

### 7.3 构建与打包

**Electron (electron-builder):**

```json
{
  "build": {
    "appId": "com.example.myapp",
    "mac": { "category": "public.app-category.utilities" },
    "win": { "target": "nsis" },
    "linux": { "target": "AppImage" }
  }
}
```

**Tauri (tauri.conf.json):**

```json
{
  "bundle": {
    "identifier": "com.example.myapp",
    "targets": ["dmg", "msi", "deb"],
    "icon": ["icons/icon.png"]
  }
}
```

**Electrobun (electrobun.config.ts):**

```typescript
export default {
  app: { name: "My App", identifier: "com.example.myapp", version: "1.0.0" },
  build: {
    bun: { entrypoint: "src/bun/index.ts" },
    mac: { codesign: true, notarize: true },
  },
  release: { baseUrl: "https://cdn.example.com/" },
} satisfies ElectrobunConfig
```

### 7.4 分发格式

| 格式                  | Electron | Tauri | Electrobun |
| --------------------- | -------- | ----- | ---------- |
| macOS .dmg            | 支持     | 支持  | 内置生成   |
| macOS .app            | 支持     | 支持  | 支持       |
| Windows .exe / .msi   | 支持     | 支持  | 支持       |
| Windows .appx (Store) | 支持     | 支持  | -          |
| Linux .deb            | 支持     | 支持  | -          |
| Linux .rpm            | 支持     | 支持  | -          |
| Linux .AppImage       | 支持     | 支持  | -          |
| Linux Snap            | 支持     | 支持  | -          |
| 自解压 ZSTD 包        | -        | -     | 内置       |
| BSDIFF 更新补丁       | -        | -     | 内置       |

---

## 八、生态对比

### 8.1 社区与生态规模

| 维度               | Electron                               | Tauri                        | Electrobun        |
| ------------------ | -------------------------------------- | ---------------------------- | ----------------- |
| GitHub Stars       | ~115k+                                 | ~90k+                        | 新项目            |
| npm 包数量         | 极多 (全 npm 生态)                     | 中等 (Rust crates + JS 插件) | 少 (Bun 兼容 npm) |
| 官方插件/模块      | 极多 (内置 + 社区)                     | 40+ 官方插件                 | 内置为主          |
| StackOverflow 问题 | 60k+                                   | 3k+                          | 极少              |
| 教程/博客          | 极丰富                                 | 丰富                         | 极少              |
| 企业级案例         | VS Code, Slack, Discord, Notion, Teams | 逐步增长                     | 早期阶段          |
| 贡献者             | 数百人                                 | 数百人                       | 小团队            |

### 8.2 生态系统对比

**Electron 生态：**

- 全部 npm 生态可用
- electron-builder, electron-forge 等成熟打包工具
- electron-updater, electron-store 等常用库
- 丰富的社区组件和模板
- 最大的桌面开发社区

**Tauri 生态：**

- 官方维护 40+ 插件（SQL, FS, HTTP, Store, Updater 等）
- Rust crates 生态（性能关键场景）
- 与 Vite、Next.js、SvelteKit 等前端工具有官方模板
- CrabNebula 提供商业化支持

**Electrobun 生态：**

- 大部分 npm 包可在 Bun 下使用
- 内置核心功能（更新、托盘、菜单等），减少第三方依赖
- 与 React、Solid、Vue 等前端框架兼容
- 社区尚在早期

### 8.3 技术栈学习成本

| 角色            | Electron       | Tauri          | Electrobun          |
| --------------- | -------------- | -------------- | ------------------- |
| 前端开发者      | 无额外学习成本 | 需学 Rust 基础 | 无额外学习成本      |
| 后端/系统开发者 | Node.js 即可   | Rust 即可      | Bun/TS 即可         |
| Rust 经验开发者 | 需学 Node.js   | 直接上手       | 需学 TypeScript/Bun |
| 全栈 JS 开发者  | 最佳选择       | 需学 Rust      | 较好选择            |

---

## 九、更新机制对比

| 维度       | Electron                 | Tauri                       | Electrobun            |
| ---------- | ------------------------ | --------------------------- | --------------------- |
| 内置更新   | 无 (需 electron-updater) | 插件 (tauri-plugin-updater) | 内置                  |
| 更新协议   | 自定义                   | HTTP + 签名验证             | HTTP + hash + BSDIFF  |
| 差量更新   | 有限支持                 | 不支持 (完整下载)           | **BSDIFF 二进制差分** |
| 最小更新包 | ~50MB+                   | ~2-10MB                     | **~14KB**             |
| 服务器需求 | 文件服务器               | HTTPS 服务器                | **仅需静态文件托管**  |
| 回滚支持   | 手动实现                 | 不支持                      | 自动补丁链            |

**Electrobun 更新流程独有优势：**

```
版本 1.0 (hash: aaa) → 版本 1.1 (hash: bbb) → 版本 1.2 (hash: ccc)

用户在 1.0:
1. 下载 aaa→ccc 的 BSDIFF 补丁 (~14KB)
2. 应用补丁
3. 验证 hash
4. 替换并重启

如果补丁链断裂，自动回退到完整 ZSTD 下载
```

---

## 十、代码结构对比

### 典型项目结构

**Electron:**

```
my-app/
├── package.json
├── main.js              # 主进程
├── preload.js           # 预加载脚本
├── renderer/
│   ├── index.html
│   ├── index.css
│   └── renderer.js      # 渲染进程
└── assets/
```

**Tauri:**

```
my-app/
├── package.json
├── src/                 # 前端代码
│   ├── index.html
│   ├── App.tsx
│   └── main.ts
├── src-tauri/
│   ├── Cargo.toml       # Rust 项目
│   ├── tauri.conf.json  # Tauri 配置
│   ├── capabilities/    # 权限配置
│   └── src/
│       └── lib.rs       # Rust 后端
└── assets/
```

**Electrobun:**

```
my-app/
├── package.json
├── electrobun.config.ts # 构建配置
├── src/
│   ├── bun/
│   │   └── index.ts     # 主进程 (Bun)
│   ├── main-ui/
│   │   ├── index.ts     # 浏览器端逻辑
│   │   └── index.html   # UI 模板
│   └── shared/
│       └── types.ts     # 共享 RPC 类型
└── assets/
```

---

## 十一、选型决策指南

### 11.1 按场景推荐

| 场景                 | 推荐                   | 原因                              |
| -------------------- | ---------------------- | --------------------------------- |
| 企业级大型应用       | Electron               | 最成熟、生态最全、Chromium 一致性 |
| MVP 快速验证         | Electrobun             | 极速启动、小体积、高频更新        |
| 已有 Rust 团队       | Tauri                  | Rust 生态、内存安全、小体积       |
| 已有 JS/TS 团队      | Electron 或 Electrobun | 无需学 Rust                       |
| 对体积极度敏感       | Tauri 或 Electrobun    | 2-14MB vs 150MB                   |
| 对启动速度极度敏感   | Electrobun             | <50ms vs 2-5s                     |
| 需要移动端           | Tauri                  | 唯一支持 iOS/Android              |
| 需要 Chromium 一致性 | Electron               | 自带 Chromium                     |
| 高频更新、带宽敏感   | Electrobun             | 14KB 更新包                       |
| 开发者工具/IDE       | Electron 或 Electrobun | 原生性能 + TS 开发效率            |
| 资源受限环境         | Tauri                  | 最小内存/体积                     |
| 需要大量 npm 包      | Electron               | npm 生态最完整                    |
| 安全审计要求严格     | Tauri                  | Rust 内存安全 + 独立审计          |

### 11.2 决策流程图

```
开始选型
  │
  ├─ 需要移动端 (iOS/Android)?
  │    └─ 是 → Tauri
  │
  ├─ 需要跨平台渲染完全一致?
  │    └─ 是 → Electron
  │
  ├─ 团队有 Rust 经验?
  │    ├─ 是 → Tauri (内存安全 + 性能)
  │    └─ 否 → 继续
  │
  ├─ 对体积/启动速度有极致要求?
  │    ├─ 是 → Electrobun
  │    └─ 否 → 继续
  │
  ├─ 需要成熟的生态和大量 npm 包?
  │    ├─ 是 → Electron
  │    └─ 否 → Electrobun
  │
  └─ 需要企业级支持和长期稳定维护?
       └─ 是 → Electron (OpenJS 基金会)
```

### 11.3 迁移成本评估

| 从 → 到               | 难度 | 主要工作量                             |
| --------------------- | ---- | -------------------------------------- |
| Electron → Tauri      | 高   | 需重写后端为 Rust，前端基本保留        |
| Electron → Electrobun | 中   | 后端从 Node.js 迁移到 Bun (大部分兼容) |
| Tauri → Electrobun    | 高   | 需从 Rust 重写为 TypeScript            |
| Tauri → Electron      | 中   | 前端保留，Rust 逻辑改写为 Node.js      |

---

## 十二、综合评分

基于 1-5 分制（5 = 最优）：

| 维度           | Electron  | Tauri     | Electrobun |
| -------------- | --------- | --------- | ---------- |
| **打包体积**   | 1         | 5         | 4          |
| **启动速度**   | 1         | 3         | 5          |
| **内存占用**   | 1         | 5         | 4          |
| **更新效率**   | 2         | 3         | 5          |
| **渲染一致性** | 5         | 2         | 3          |
| **API 完整度** | 5         | 4         | 3          |
| **生态丰富度** | 5         | 4         | 1          |
| **社区支持**   | 5         | 4         | 1          |
| **类型安全**   | 2         | 4         | 5          |
| **学习曲线**   | 5         | 2         | 4          |
| **安全模型**   | 3         | 5         | 4          |
| **平台覆盖**   | 4         | 5         | 3          |
| **移动端支持** | 1         | 5         | 1          |
| **长期稳定性** | 5         | 4         | 2          |
| **文档质量**   | 5         | 4         | 4          |
| **开发工具链** | 5         | 4         | 3          |
| **总分**       | **51/80** | **61/80** | **51/80**  |

---

## 十三、总结

### Electron：稳妥之选

经过 10+ 年验证的成熟框架。适合企业级应用、大型团队、以及需要完全可控渲染环境的场景。代价是较大的体积和启动开销，但换来的是无与伦比的生态和稳定性。

### Tauri：现代之选

Rust 带来的内存安全和极致体积优化。适合安全敏感应用、资源受限场景、以及愿意投入学习 Rust 的团队。v2 加入的移动端支持使其成为唯一的全平台 Web 桌面/移动方案。

### Electrobun：效率之选

纯 TypeScript + Bun 的极致开发效率和运行时性能。特别是 <50ms 启动和 14KB 更新在同类框架中独树一帜。适合需要快速迭代、高频更新的应用，但目前生态和平台成熟度仍有待发展。

> **没有最好的框架，只有最适合场景的选择。**

---

_文档生成日期：2026-03-28_
_参考来源：_

- https://www.electronjs.org/docs/latest/
- https://v2.tauri.app/
- https://blackboard.sh/electrobun/docs/
