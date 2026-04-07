# Electrobun 代码实践指南

> 从零到一的完整代码示例，涵盖核心功能和常见模式

## 目录

1. [项目初始化](#一项目初始化)
2. [Hello World](#二hello-world)
3. [创建自定义 UI](#三创建自定义-ui)
4. [类型安全 RPC 通信](#四类型安全-rpc-通信)
5. [系统托盘应用](#五系统托盘应用)
6. [窗口管理进阶](#六窗口管理进阶)
7. [事件系统实践](#七事件系统实践)
8. [文件对话框与工具 API](#八文件对话框与工具-api)
9. [自定义标题栏与透明窗口](#九自定义标题栏与透明窗口)
10. [多 Webview 嵌入](#十多-webview-嵌入)
11. [应用更新机制](#十一应用更新机制)
12. [Session 与 Cookie 管理](#十二session-与-cookie-管理)
13. [完整项目模板](#十三完整项目模板)

---

## 一、项目初始化

### 方式一：使用模板（推荐快速开始）

```bash
bunx electrobun init
```

可选模板：`hello-world`、`photo-booth`、`web-browser`

### 方式二：从零搭建

```bash
mkdir my-app && cd my-app
bun init .
bun install electrobun
```

配置 `package.json`：

```json
{
  "name": "my-app",
  "devDependencies": {
    "@types/bun": "latest"
  },
  "peerDependencies": {
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "electrobun": "^0.0.1"
  },
  "scripts": {
    "start": "bun run build:dev && electrobun dev",
    "build:dev": "bun install && electrobun build"
  }
}
```

创建 `electrobun.config.ts`：

```typescript
import type { ElectrobunConfig } from "electrobun"

export default {
  app: {
    name: "My App",
    identifier: "dev.my.app",
    version: "0.0.1",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
  },
} satisfies ElectrobunConfig
```

---

## 二、Hello World

最简单的 Electrobun 应用，打开一个窗口并加载网页：

`**src/bun/index.ts**`

```typescript
import { BrowserWindow } from "electrobun/bun"

const win = new BrowserWindow({
  title: "Hello Electrobun",
  url: "https://electrobun.dev",
})
```

运行：

```bash
bun start
```

使用 `views://` 加载本地 HTML：

```typescript
import { BrowserWindow } from "electrobun/bun"

const win = new BrowserWindow({
  title: "Hello Local",
  url: "views://mainview/index.html",
})
```

使用内联 HTML：

```typescript
import { BrowserWindow } from "electrobun/bun"

const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      font-family: -apple-system, sans-serif;
      background: #1a1a2e;
      color: #e94560;
    }
    h1 { font-size: 3rem; }
  </style>
</head>
<body>
  <h1>Hello Electrobun!</h1>
</body>
</html>
`

const win = new BrowserWindow({
  title: "Inline HTML",
  html,
})
```

---

## 三、创建自定义 UI

### 3.1 配置多 View

更新 `electrobun.config.ts`：

```typescript
import type { ElectrobunConfig } from "electrobun"

export default {
  app: {
    name: "My App",
    identifier: "dev.my.app",
    version: "0.0.1",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      "main-ui": {
        entrypoint: "src/main-ui/index.ts",
      },
    },
    copy: {
      "src/main-ui/index.html": "views/main-ui/index.html",
      "src/main-ui/index.css": "views/main-ui/index.css",
    },
  },
} satisfies ElectrobunConfig
```

### 3.2 Browser 侧 TypeScript

`**src/main-ui/index.ts**`

```typescript
import { Electroview } from "electrobun/view"

const electrobun = new Electroview({ rpc: null })

window.loadPage = () => {
  const url = (document.querySelector("#urlInput") as HTMLInputElement).value
  const webview = document.querySelector(".webview") as any
  webview.src = url
}

window.goBack = () => {
  const webview = document.querySelector(".webview") as any
  webview.goBack()
}

window.goForward = () => {
  const webview = document.querySelector(".webview") as any
  webview.goForward()
}
```

### 3.3 HTML 模板

`**src/main-ui/index.html**`

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Web Browser</title>
    <link rel="stylesheet" href="views://main-ui/index.css" />
    <script src="views://main-ui/index.js"></script>
  </head>
  <body>
    <div class="toolbar">
      <button onclick="goBack()" class="nav-btn">&larr;</button>
      <button onclick="goForward()" class="nav-btn">&rarr;</button>
      <input
        type="text"
        id="urlInput"
        placeholder="输入 URL..."
        value="https://electrobun.dev"
      />
      <button onclick="loadPage()">访问</button>
    </div>
    <electrobun-webview
      class="webview"
      width="100%"
      height="100%"
      src="https://electrobun.dev"
    >
    </electrobun-webview>
  </body>
</html>
```

`**src/main-ui/index.css**`

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #f5f5f5;
  border-bottom: 1px solid #ddd;
}

.nav-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  background: #e0e0e0;
  cursor: pointer;
  font-size: 14px;
}

.nav-btn:hover {
  background: #d0d0d0;
}

#urlInput {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
}

#urlInput:focus {
  border-color: #4a90d9;
}

.toolbar button:last-child {
  padding: 8px 16px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.toolbar button:last-child:hover {
  background: #357abd;
}

.webview {
  flex: 1;
  border: none;
}
```

### 3.4 设置应用菜单（启用快捷键）

`**src/bun/index.ts**`

```typescript
import { BrowserWindow, ApplicationMenu } from "electrobun/bun"

ApplicationMenu.setApplicationMenu([
  {
    submenu: [{ label: "Quit", role: "quit" }],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    label: "View",
    submenu: [{ role: "toggleFullScreen" }],
  },
])

const win = new BrowserWindow({
  title: "My Web Browser",
  url: "views://main-ui/index.html",
  frame: {
    width: 1200,
    height: 800,
  },
})
```

---

## 四、类型安全 RPC 通信

### 4.1 定义共享类型

`**src/shared/types.ts**`

```typescript
import { type RPCSchema } from "electrobun/bun"

export type AppRPCType = {
  bun: RPCSchema<{
    requests: {
      readFileContent: {
        params: { filePath: string }
        response: { content: string; error?: string }
      }
      saveFileContent: {
        params: { filePath: string; content: string }
        response: { success: boolean; error?: string }
      }
      getSystemInfo: {
        params: Record<string, never>
        response: {
          platform: string
          arch: string
          Bun: { version: string }
          paths: Record<string, string>
        }
      }
    }
    messages: {
      logToBun: { level: "info" | "warn" | "error"; msg: string }
      notifyUser: { title: string; body: string }
    }
  }>
  webview: RPCSchema<{
    requests: {
      confirmAction: {
        params: { message: string }
        response: boolean
      }
      updateStatusBar: {
        params: { text: string; type: "info" | "success" | "error" }
        response: void
      }
    }
    messages: {
      showNotification: { title: string; body: string }
    }
  }>
}
```

### 4.2 Bun 主进程处理

`**src/bun/index.ts**`

```typescript
import { BrowserWindow, BrowserView, Utils } from "electrobun/bun"
import { type AppRPCType } from "../shared/types"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

const rpc = BrowserView.defineRPC<AppRPCType>({
  maxRequestTime: 10000,
  handlers: {
    requests: {
      readFileContent: ({ filePath }) => {
        try {
          const content = readFileSync(filePath, "utf-8")
          return { content }
        } catch (err: any) {
          return { content: "", error: err.message }
        }
      },
      saveFileContent: ({ filePath, content }) => {
        try {
          mkdirSync(join(filePath, ".."), { recursive: true })
          writeFileSync(filePath, content, "utf-8")
          return { success: true }
        } catch (err: any) {
          return { success: false, error: err.message }
        }
      },
      getSystemInfo: () => {
        return {
          platform: process.platform,
          arch: process.arch,
          Bun: { version: Bun.version },
          paths: {
            home: Utils.paths.home,
            userData: Utils.paths.userData,
            downloads: Utils.paths.downloads,
          },
        }
      },
    },
    messages: {
      "*": (messageName, payload) => {
        console.log("[Global Message]", messageName, payload)
      },
      logToBun: ({ level, msg }) => {
        const timestamp = new Date().toISOString()
        console.log(`[${timestamp}] [${level.toUpperCase()}] ${msg}`)
      },
      notifyUser: ({ title, body }) => {
        Utils.showNotification({ title, body })
      },
    },
  },
})

const win = new BrowserWindow({
  title: "RPC Demo",
  url: "views://main-ui/index.html",
  frame: { width: 900, height: 600 },
  rpc,
})
```

### 4.3 Browser 侧调用

`**src/main-ui/index.ts**`

```typescript
import { Electroview } from "electrobun/view"
import { type AppRPCType } from "../shared/types"

const rpc = Electroview.defineRPC<AppRPCType>({
  handlers: {
    requests: {
      confirmAction: ({ message }) => {
        return confirm(message)
      },
      updateStatusBar: ({ text, type }) => {
        const bar = document.getElementById("status-bar")
        if (bar) {
          bar.textContent = text
          bar.className = `status-${type}`
        }
        return
      },
    },
    messages: {
      showNotification: ({ title, body }) => {
        new Notification(title, { body })
      },
    },
  },
})

const electroview = new Electroview({ rpc })

async function fetchSystemInfo() {
  const info = await electroview.rpc.request.getSystemInfo({})
  console.log("System Info:", info)
  return info
}

async function saveFile() {
  const content = document.getElementById("editor")?.textContent || ""
  const result = await electroview.rpc.request.saveFileContent({
    filePath: join(Utils.paths.userData, "notes.txt"),
    content,
  })
  if (result.success) {
    electroview.rpc.send.logToBun({
      level: "info",
      msg: "File saved successfully",
    })
  }
}

electroview.rpc.send.logToBun({ level: "info", msg: "UI loaded" })
```

---

## 五、系统托盘应用

`**src/bun/index.ts**`

```typescript
import { Tray, Utils } from "electrobun/bun"

Utils.setDockIconVisible(false)

const menuState = {
  "toggle-visible": true,
  "auto-update": false,
}

const tray = new Tray({
  title: "My App",
  image: "views://assets/icon-template.png",
  template: true,
  width: 22,
  height: 22,
})

function updateMenu() {
  tray.setMenu([
    {
      type: "normal",
      label: "Show Window",
      action: "show-window",
    },
    { type: "divider" },
    {
      type: "normal",
      label: `Auto Update: ${menuState["auto-update"] ? "On" : "Off"}`,
      action: "toggle-update",
    },
    { type: "divider" },
    {
      type: "normal",
      label: "Check for Updates",
      action: "check-update",
    },
    { type: "divider" },
    {
      type: "normal",
      label: "Quit",
      action: "quit",
    },
  ])
}

tray.on("tray-clicked", (e) => {
  const { action } = e.data as { action: string }

  switch (action) {
    case "":
      updateMenu()
      break
    case "show-window":
      mainWindow?.show()
      mainWindow?.focus()
      break
    case "toggle-update":
      menuState["auto-update"] = !menuState["auto-update"]
      updateMenu()
      break
    case "check-update":
      checkForUpdates()
      break
    case "quit":
      Utils.quit()
      break
  }
})
```

---

## 六、窗口管理进阶

`**src/bun/index.ts**`

```typescript
import { BrowserWindow, Screen } from "electrobun/bun"

const primary = Screen.getPrimaryDisplay()

const win = new BrowserWindow({
  title: "Advanced Window",
  url: "views://main-ui/index.html",
  frame: {
    width: 1000,
    height: 700,
    x: Math.round((primary.workArea.width - 1000) / 2) + primary.workArea.x,
    y: Math.round((primary.workArea.height - 700) / 2) + primary.workArea.y,
  },
  titleBarStyle: "hiddenInset",
  transparent: true,
})

win.on("resize", (e) => {
  const { width, height } = e.data
  console.log(`Window resized: ${width}x${height}`)
})

win.on("move", (e) => {
  const { x, y } = e.data
  console.log(`Window moved to: (${x}, ${y})`)
})

win.on("focus", () => {
  console.log("Window focused")
})

win.on("close", () => {
  console.log("Window closing...")
})

setAlwaysOnTop()
async function setAlwaysOnTop() {
  win.setAlwaysOnTop(true)
  await new Promise((r) => setTimeout(r, 3000))
  win.setAlwaysOnTop(false)
}

win.setVisibleOnAllWorkspaces(true)
win.setPageZoom(1.5)
console.log("Current zoom:", win.getPageZoom())
```

---

## 七、事件系统实践

`**src/bun/index.ts**`

```typescript
import Electrobun from "electrobun/bun"
import { BrowserWindow, Utils } from "electrobun/bun"

function saveAppState() {
  console.log("Saving app state...")
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      console.log("State saved")
      resolve()
    }, 500)
  })
}

function hasUnsavedChanges() {
  return false
}

Electrobun.events.on("before-quit", async (e) => {
  if (hasUnsavedChanges()) {
    e.response = { allow: false }
    console.log("Quit cancelled: unsaved changes")
    return
  }
  await saveAppState()
  console.log("Cleanup complete")
})

Electrobun.events.on("will-navigate", (e) => {
  console.log("Navigating to:", e.data.url)
  if (e.data.url.includes("blocked")) {
    e.response = { allow: false }
  }
})

Electrobun.events.on("open-url", (e) => {
  const url = new URL(e.data.url)
  console.log("Deep link opened:", url.pathname)
})

const win = new BrowserWindow({
  title: "Events Demo",
  url: "views://main-ui/index.html",
  sandbox: true,
})

win.webview.on("dom-ready", () => {
  console.log("Page loaded")
})

win.webview.on("will-navigate", (e) => {
  const url = e.data.detail
  console.log("WebView navigating:", url)
})
```

---

## 八、文件对话框与工具 API

`**src/bun/index.ts**`

```typescript
import { Utils, BrowserWindow, GlobalShortcut } from "electrobun/bun"
import { join } from "path"
import { writeFileSync } from "fs"

const win = new BrowserWindow({
  title: "Utils Demo",
  url: "views://main-ui/index.html",
  frame: { width: 800, height: 600 },
})

async function openFile() {
  const paths = await Utils.openFileDialog({
    startingFolder: Utils.paths.desktop,
    allowedFileTypes: "png,jpg,jpeg,gif",
    canChooseFiles: true,
    canChooseDirectory: false,
    allowsMultipleSelection: false,
  })

  if (paths.length > 0) {
    console.log("Selected:", paths[0])
    Utils.showItemInFolder(paths[0])
  }
}

async function saveFile() {
  const { response } = await Utils.showMessageBox({
    type: "question",
    title: "确认保存",
    message: "是否保存当前文件？",
    buttons: ["保存", "取消"],
    defaultId: 0,
    cancelId: 1,
  })

  if (response === 0) {
    const savePath = join(Utils.paths.downloads, "output.txt")
    writeFileSync(savePath, "Hello from Electrobun!")
    Utils.showNotification({
      title: "保存成功",
      body: `文件已保存到: ${savePath}`,
    })
  }
}

Utils.clipboardWriteText("Copied from Electrobun!")
const clipboardText = Utils.clipboardReadText()
console.log("Clipboard:", clipboardText)

GlobalShortcut.register("CommandOrControl+Shift+H", () => {
  if (win.isVisible()) {
    win.hide()
  } else {
    win.show()
    win.focus()
  }
})
```

---

## 九、自定义标题栏与透明窗口

### 9.1 Bun 主进程

`**src/bun/index.ts**`

```typescript
import { BrowserWindow } from "electrobun/bun"

const win = new BrowserWindow({
  title: "Custom Titlebar",
  url: "views://main-ui/index.html",
  frame: { width: 800, height: 500 },
  titleBarStyle: "hidden",
  transparent: true,
})
```

### 9.2 HTML/CSS

`**src/main-ui/index.html**`

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <script src="views://main-ui/index.js"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      html,
      body {
        background: transparent;
        height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        overflow: hidden;
      }

      .app-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      }

      .titlebar {
        display: flex;
        align-items: center;
        height: 38px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        -webkit-app-region: drag;
        user-select: none;
        padding: 0 12px;
      }

      .titlebar-title {
        color: white;
        font-size: 13px;
        font-weight: 500;
      }

      .traffic-lights {
        display: flex;
        gap: 8px;
        margin-right: 12px;
        -webkit-app-region: no-drag;
      }

      .traffic-light {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        cursor: pointer;
        transition: opacity 0.2s;
      }

      .traffic-light:hover {
        opacity: 0.8;
      }
      .traffic-close {
        background: #ff5f57;
      }
      .traffic-minimize {
        background: #ffbd2e;
      }
      .traffic-maximize {
        background: #28c840;
      }

      .content {
        flex: 1;
        background: #1a1a2e;
        color: #eee;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
      }
    </style>
  </head>
  <body>
    <div class="app-container">
      <div class="titlebar">
        <div class="traffic-lights">
          <div
            class="traffic-light traffic-close"
            onclick="window.electrobun?.close?.()"
          ></div>
          <div
            class="traffic-light traffic-minimize"
            onclick="window.electrobun?.minimize?.()"
          ></div>
          <div
            class="traffic-light traffic-maximize"
            onclick="window.electrobun?.maximize?.()"
          ></div>
        </div>
        <span class="titlebar-title">My App</span>
      </div>
      <div class="content">Custom Titlebar Demo</div>
    </div>
  </body>
</html>
```

---

## 十、多 Webview 嵌入

使用 `<electrobun-webview>` 标签在单个页面中嵌入多个隔离的 webview（OOPIF 模式）：

`**src/main-ui/index.html**`

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <script src="views://main-ui/index.js"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
      }
      body {
        display: flex;
        flex-direction: column;
        height: 100vh;
      }

      .tab-bar {
        display: flex;
        background: #2d2d2d;
        padding: 4px 4px 0;
        gap: 2px;
      }

      .tab {
        padding: 8px 20px;
        background: #3d3d3d;
        color: #aaa;
        border: none;
        border-radius: 8px 8px 0 0;
        cursor: pointer;
        font-size: 13px;
      }

      .tab.active {
        background: #1e1e1e;
        color: #fff;
      }

      .webview-container {
        flex: 1;
        position: relative;
      }

      .webview-panel {
        position: absolute;
        inset: 0;
        display: none;
      }

      .webview-panel.active {
        display: block;
      }
    </style>
  </head>
  <body>
    <div class="tab-bar">
      <button class="tab active" onclick="switchTab(0)">Electrobun</button>
      <button class="tab" onclick="switchTab(1)">Google</button>
      <button class="tab" onclick="switchTab(2)">GitHub</button>
    </div>

    <div class="webview-container">
      <div class="webview-panel active">
        <electrobun-webview
          width="100%"
          height="100%"
          src="https://electrobun.dev"
        >
        </electrobun-webview>
      </div>
      <div class="webview-panel">
        <electrobun-webview width="100%" height="100%" src="https://google.com">
        </electrobun-webview>
      </div>
      <div class="webview-panel">
        <electrobun-webview width="100%" height="100%" src="https://github.com">
        </electrobun-webview>
      </div>
    </div>
  </body>
</html>
```

`**src/main-ui/index.ts**`

```typescript
import { Electroview } from "electrobun/view"

new Electroview({ rpc: null })

window.switchTab = (index: number) => {
  document.querySelectorAll(".tab").forEach((tab, i) => {
    tab.classList.toggle("active", i === index)
  })
  document.querySelectorAll(".webview-panel").forEach((panel, i) => {
    panel.classList.toggle("active", i === index)
  })
}
```

---

## 十一、应用更新机制

`**src/bun/index.ts**`

```typescript
import { BrowserWindow, Tray, Utils } from "electrobun/bun"
import Electrobun from "electrobun/bun"

async function checkForUpdates() {
  console.log("Checking for updates...")

  try {
    const localInfo = await Electrobun.Updater.getLocalInfo()
    console.log(
      `Current version: ${localInfo.version} (${localInfo.hash.slice(0, 8)})`
    )

    const updateInfo = await Electrobun.Updater.checkForUpdate()

    if (updateInfo.error) {
      console.error("Update check failed:", updateInfo.error)
      return
    }

    if (!updateInfo.updateAvailable) {
      console.log("Already up to date!")
      return
    }

    console.log(`Update available: ${updateInfo.version}`)
    console.log("Downloading update...")

    await Electrobun.Updater.downloadUpdate()

    if (Electrobun.Updater.updateInfo()?.updateReady) {
      console.log("Update ready, applying...")
      await Electrobun.Updater.applyUpdate()
    }
  } catch (err) {
    console.error("Update failed:", err)
  }
}

const tray = new Tray({
  title: "My App (checking...)",
  image: "views://assets/icon-template.png",
  template: true,
  width: 22,
  height: 22,
})

tray.on("tray-clicked", (e) => {
  const { action } = e.data as { action: string }
  switch (action) {
    case "":
      tray.setMenu([
        { type: "normal", label: "Check for Updates", action: "check-update" },
        { type: "divider" },
        { type: "normal", label: "Quit", action: "quit" },
      ])
      break
    case "check-update":
      checkForUpdates()
      break
    case "quit":
      Utils.quit()
      break
  }
})

const win = new BrowserWindow({
  title: "My App",
  url: "views://main-ui/index.html",
})

setTimeout(checkForUpdates, 5000)
```

对应配置 `electrobun.config.ts`：

```typescript
export default {
  app: {
    name: "My App",
    identifier: "com.example.myapp",
    version: "1.0.0",
  },
  build: {
    bun: { entrypoint: "src/bun/index.ts" },
  },
  release: {
    baseUrl: "https://your-cdn.example.com/myapp/",
  },
} satisfies ElectrobunConfig
```

---

## 十二、Session 与 Cookie 管理

`**src/bun/index.ts**`

```typescript
import { Session, BrowserWindow } from "electrobun/bun"

const session = Session.fromPartition("persist:myapp")

session.cookies.set({
  name: "user_session",
  value: "abc123",
  domain: "myapp.com",
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "strict",
  expirationDate: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
})

function listCookies() {
  const cookies = session.cookies.get()
  console.log(`Found ${cookies.length} cookies`)
  cookies.forEach((c) => console.log(`  ${c.name}=${c.value}`))
}

function logout() {
  session.cookies.remove("https://api.myapp.com", "user_session")
  session.cookies.remove("https://api.myapp.com", "refresh_token")
  session.clearStorageData(["localStorage", "sessionStorage"])
  console.log("User logged out")
}

const win = new BrowserWindow({
  title: "Session Demo",
  url: "https://myapp.com",
  partition: "persist:myapp",
})

const tempWin = new BrowserWindow({
  title: "Incognito",
  url: "https://myapp.com",
  partition: "incognito",
})

const defaultSession = Session.defaultSession
console.log("Default partition:", defaultSession.partition)
```

---

## 十三、完整项目模板

以下是一个推荐的完整项目结构：

```
my-app/
├── electrobun.config.ts
├── package.json
├── tsconfig.json
├── assets/
│   └── icon-template.png
├── scripts/
│   ├── pre-build.ts
│   └── post-build.ts
└── src/
    ├── bun/
    │   └── index.ts
    ├── main-ui/
    │   ├── index.ts
    │   ├── index.html
    │   └── index.css
    └── shared/
        └── types.ts
```

**完整 `electrobun.config.ts`**：

```typescript
import type { ElectrobunConfig } from "electrobun"

export default {
  app: {
    name: "My App",
    identifier: "com.example.myapp",
    version: "1.0.0",
    urlSchemes: ["myapp"],
  },
  runtime: {
    exitOnLastWindowClosed: true,
    theme: "system",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
      external: [],
      sourcemap: "linked",
    },
    views: {
      "main-ui": {
        entrypoint: "src/main-ui/index.ts",
        sourcemap: "linked",
      },
    },
    copy: {
      "src/main-ui/index.html": "views/main-ui/index.html",
      "src/main-ui/index.css": "views/main-ui/index.css",
      "assets/icon-template.png": "views/assets/icon-template.png",
    },
    watch: ["scripts"],
    watchIgnore: ["**/*.generated.*"],
    mac: {
      codesign: false,
      notarize: false,
      entitlements: {
        "com.apple.security.device.camera": "Camera access",
        "com.apple.security.device.microphone": "Microphone access",
      },
      icons: "assets/icon.iconset",
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
  scripts: {
    preBuild: "./scripts/pre-build.ts",
    postBuild: "./scripts/post-build.ts",
  },
  release: {
    baseUrl: process.env.RELEASE_BASE_URL || "",
  },
} satisfies ElectrobunConfig
```

**完整 `src/bun/index.ts`**：

```typescript
import Electrobun from "electrobun/bun"
import {
  BrowserWindow,
  BrowserView,
  ApplicationMenu,
  Utils,
  Tray,
} from "electrobun/bun"
import { type AppRPCType } from "../shared/types"
import { join } from "path"
import { mkdirSync, writeFileSync } from "fs"

function setupRPC() {
  return BrowserView.defineRPC<AppRPCType>({
    maxRequestTime: 10000,
    handlers: {
      requests: {
        readFileContent: ({ filePath }) => {
          try {
            const { readFileSync } = require("fs")
            return { content: readFileSync(filePath, "utf-8") }
          } catch (err: any) {
            return { content: "", error: err.message }
          }
        },
        saveFileContent: ({ filePath, content }) => {
          try {
            mkdirSync(join(filePath, ".."), { recursive: true })
            writeFileSync(filePath, content, "utf-8")
            return { success: true }
          } catch (err: any) {
            return { success: false, error: err.message }
          }
        },
        getSystemInfo: () => ({
          platform: process.platform,
          arch: process.arch,
          Bun: { version: Bun.version },
          paths: {
            home: Utils.paths.home,
            userData: Utils.paths.userData,
            downloads: Utils.paths.downloads,
          },
        }),
      },
      messages: {
        "*": (name, payload) => console.log("[MSG]", name, payload),
        logToBun: ({ level, msg }) =>
          console.log(`[${new Date().toISOString()}] [${level}] ${msg}`),
        notifyUser: ({ title, body }) =>
          Utils.showNotification({ title, body }),
      },
    },
  })
}

function setupMenu() {
  ApplicationMenu.setApplicationMenu([
    {
      submenu: [
        { label: "About", action: "about" },
        { type: "separator" },
        { label: "Quit", role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "toggleFullScreen" },
        { label: "Toggle Developer Tools", action: "toggle-devtools" },
      ],
    },
  ])
}

function setupEvents() {
  Electrobun.events.on("before-quit", (e) => {
    console.log("App quitting...")
    const userDataDir = join(Utils.paths.userData, "state.json")
    mkdirSync(Utils.paths.userData, { recursive: true })
    writeFileSync(
      userDataDir,
      JSON.stringify({
        lastClosed: new Date().toISOString(),
      })
    )
  })

  Electrobun.events.on("open-url", (e) => {
    const url = new URL(e.data.url)
    console.log("Deep link:", url.pathname)
  })
}

function createMainWindow(rpc: any) {
  const win = new BrowserWindow({
    title: "My App",
    url: "views://main-ui/index.html",
    frame: { width: 1000, height: 700 },
    rpc,
  })

  win.on("close", () => console.log("Main window closed"))

  return win
}

function main() {
  const rpc = setupRPC()
  setupMenu()
  setupEvents()
  createMainWindow(rpc)
  console.log("App started")
}

main()
```

**完整 `src/main-ui/index.ts`**：

```typescript
import { Electroview } from "electrobun/view"
import { type AppRPCType } from "../shared/types"

const rpc = Electroview.defineRPC<AppRPCType>({
  handlers: {
    requests: {
      confirmAction: ({ message }) => confirm(message),
      updateStatusBar: ({ text, type }) => {
        const bar = document.getElementById("status-bar")
        if (bar) {
          bar.textContent = text
          bar.className = `status-${type}`
        }
        return
      },
    },
    messages: {
      showNotification: ({ title, body }) => {
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(title, { body })
        }
      },
    },
  },
})

const electroview = new Electroview({ rpc })

document.addEventListener("DOMContentLoaded", async () => {
  electroview.rpc.send.logToBun({ level: "info", msg: "UI loaded" })

  const info = await electroview.rpc.request.getSystemInfo({})
  const infoEl = document.getElementById("sys-info")
  if (infoEl) {
    infoEl.textContent = `${info.platform} ${info.arch} | Bun ${info.Bun.version}`
  }
})
```

---

## 附录：常用命令速查

```bash
# 开发
bun start                       # 构建并启动开发模式
bunx electrobun dev --watch     # 监听文件变化自动重建

# 构建
bunx electrobun build           # 构建开发版本
bunx electrobun build canary    # 构建 canary 版本
bunx electrobun build stable    # 构建 stable 版本

# 初始化
bunx electrobun init            # 使用模板创建项目

# 安装
bun install electrobun          # 安装 Electrobun 依赖
```

---

*文档生成日期：2026-03-28*
*参考文档：[https://blackboard.sh/electrobun/docs/](https://blackboard.sh/electrobun/docs/)*