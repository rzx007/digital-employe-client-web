# Electrobun 使用报告

> 基于 Electrobun 官方文档（https://blackboard.sh/electrobun/docs/）的深度分析与实践总结

## 一、Electrobun 概述

Electrobun 是一个新兴的跨平台桌面应用框架，由 Blackboard 团队开发，使用 TypeScript 作为主要开发语言，Bun 作为后端运行时。其核心理念是在不牺牲开发者体验的前提下，提供极致的性能表现。

### 1.1 核心定位

Electrobun 旨在解决传统桌面开发中"开发者体验"与"应用性能"之间的矛盾：

| 维度     | Electron     | Tauri        | Electrobun              |
| -------- | ------------ | ------------ | ----------------------- |
| 打包体积 | 150MB+       | 25MB         | **14MB**                |
| 更新大小 | 100MB+       | 10MB         | **14KB**                |
| 启动时间 | 2-5s         | 500ms        | **<50ms**               |
| 内存占用 | 100-200MB    | 30-50MB      | **15-30MB**             |
| 开发语言 | JS/TS        | Rust + TS    | **纯 TypeScript**       |
| 运行时   | Node.js + V8 | 系统原生     | **Bun**                 |
| 渲染引擎 | Chromium     | 系统 WebView | 系统 WebView + 可选 CEF |

### 1.2 技术架构

Electrobun 的架构可以分为以下几个层次：

```
┌─────────────────────────────────────────────┐
│              用户应用层 (TypeScript)          │
├──────────────────┬──────────────────────────┤
│   Bun 主进程      │     Browser Views (UI)   │
│  - 窗口管理       │   - HTML/CSS/JS          │
│  - 系统托盘       │   - React/Solid/Vue...   │
│  - RPC 通信       │   - Electroview API      │
├──────────────────┼──────────────────────────┤
│        Bun 运行时 (JS 引擎 + 打包器)          │
├──────────────────┴──────────────────────────┤
│          原生绑定层 (Zig/C++/ObjC)           │
├─────────────────────────────────────────────┤
│         操作系统 (macOS/Windows/Linux)        │
└─────────────────────────────────────────────┘
```

**关键设计决策：**

1. **Zig 原生绑定**：原生功能（窗口管理、系统托盘、应用菜单）使用 C++、ObjC 和 Zig 编写，通过 Bun 的 FFI（外部函数接口）调用
2. **Bun 运行时**：主进程运行在 Bun 上，提供极快的 TypeScript 执行速度和内置打包能力
3. **系统 WebView**：默认使用系统原生 WebView（macOS: WebKit，Windows: Edge WebView2，Linux: WebKitGTK），可选打包 CEF（Chromium）
4. **自定义更新系统**：基于 SIMD 优化的 BSDIFF 实现，更新包通常仅数 KB
5. **ZSTD 自解压分发**：使用 ZSTD 压缩算法打包应用，初始下载尽可能小

### 1.3 应用包结构（以 macOS 为例）

```
MyApp.app/
├── Contents/
│   ├── MacOS/
│   │   ├── bspatch          # BSDIFF 补丁工具（Zig 实现）
│   │   ├── bun              # Bun 运行时
│   │   ├── launcher         # 启动器（Zig 二进制）
│   │   └── libNativeWrapper.dylib  # 原生绑定层
│   └── Resources/
│       ├── AppIcon.icns
│       ├── version.json     # 版本信息（更新检查用）
│       └── app/
│           ├── bun/         # 主进程编译产物
│           └── views/       # UI 视图编译产物
```

## 二、核心 API 分析

### 2.1 Bun 侧 API（主进程）

| API               | 功能                         | 重要性 |
| ----------------- | ---------------------------- | ------ |
| `BrowserWindow`   | 创建和控制浏览器窗口         | 核心   |
| `BrowserView`     | 创建和管理 webview           | 核心   |
| `ApplicationMenu` | 原生应用菜单栏               | 高     |
| `Tray`            | 系统托盘                     | 中     |
| `Context Menu`    | 右键上下文菜单               | 中     |
| `Events`          | 事件系统                     | 核心   |
| `Utils`           | 文件系统、剪贴板、通知等工具 | 高     |
| `Updater`         | 内置更新机制                 | 高     |
| `Paths`           | 跨平台路径管理               | 中     |
| `Screen`          | 屏幕和显示器信息             | 中     |
| `Session`         | Cookie 和存储管理            | 中     |
| `GlobalShortcut`  | 全局键盘快捷键               | 低     |
| `WebGPU`          | 原生 GPU 窗口                | 低     |
| `BuildConfig`     | 运行时构建配置读取           | 中     |

### 2.2 Browser 侧 API（渲染进程）

| API                    | 功能                         |
| ---------------------- | ---------------------------- |
| `Electroview`          | 初始化 Electrobun 浏览器 API |
| `<electrobun-webview>` | 嵌入式 webview 标签（OOPIF） |
| `<electrobun-wgpu>`    | 嵌入式 GPU surface 标签      |
| Draggable Regions      | HTML 元素可拖拽区域          |
| Global Properties      | 浏览器上下文全局属性         |

### 2.3 IPC 通信机制

Electrobun 提供了类型安全的 RPC（远程过程调用）机制，用于 Bun 主进程与 Browser 渲染进程之间的通信：

```
Bun 主进程                          Browser 渲染进程
┌──────────────┐                   ┌──────────────┐
│              │  ── request ──>   │              │
│  RPC Handler │  <── response ── │  RPC Caller  │
│              │                   │              │
│              │  <── message ──   │              │
│  Msg Handler │  ── message ──>  │  Msg Sender  │
└──────────────┘                   └──────────────┘
```

**关键特性：**

- 完全类型安全，共享 TypeScript 类型定义
- `request`：有返回值的异步调用
- `message`：单向消息传递
- 加密通信
- 沙箱模式下自动禁用 RPC

## 三、事件系统

### 3.1 事件传播

- 大多数事件支持在对象级别和全局级别监听
- 全局事件处理器通常先于对象级处理器触发
- **例外**：窗口 `close` 事件中，per-window 处理器先于全局处理器触发

### 3.2 事件响应机制

部分事件支持 `response` 属性，允许通过事件处理流程修改原生行为：

```typescript
// 例如 will-navigate 事件可以阻止导航
Electrobun.events.on("will-navigate", (e) => {
  if (e.data.url.includes("blocked.com")) {
    e.response = { allow: false }
  }
})
```

### 3.3 应用生命周期事件

| 事件             | 触发时机                                 |
| ---------------- | ---------------------------------------- |
| `open-url`       | 通过自定义 URL scheme 打开应用（深链接） |
| `before-quit`    | 应用退出前（可取消）                     |
| `close`          | 窗口关闭                                 |
| `resize`         | 窗口大小改变                             |
| `move`           | 窗口位置改变                             |
| `focus` / `blur` | 窗口获得/失去焦点                        |

## 四、构建与分发

### 4.1 构建配置

`electrobun.config.ts` 是核心配置文件，支持以下功能：

- **应用信息**：名称、标识符、版本
- **Bun 打包**：入口文件、插件、外部依赖
- **视图配置**：多个 view 的 TypeScript 入口和 HTML 复制
- **平台特定配置**：代码签名、公证、CEF 打包、Chromium flags
- **运行时配置**：退出行为、自定义运行时值
- **构建钩子**：preBuild、postBuild、postWrap、postPackage
- **更新配置**：baseUrl、频道管理

### 4.2 分发产物

1. **应用包**：完整的 .app/.exe 应用
2. **自解压 ZSTD 包**：压缩约 5 倍，首次运行自动解压
3. **DMG**：macOS 安装镜像
4. **更新补丁**：BSDIFF 二进制差分补丁

### 4.3 更新流程

```
1. 检查本地 version.json hash vs 远程 update.json hash
         │
    hash 不同？
    /       \
   是        否 → 无需更新
   │
2. 下载匹配当前 hash 的补丁文件
   │
3. 应用补丁 → 生成新 hash
   │
   匹配最新 hash？
   /       \
  是        否 → 尝试下一个补丁链
  │
4. 替换应用并重启
   │
   补丁链断裂？
   ↓
5. 下载完整 ZSTD 压缩包完成更新
```

## 五、安全模型

### 5.1 沙箱模式

`sandbox: true` 可为不可信内容（如用户提供的 URL、第三方网站）创建隔离环境：

- **允许**：事件发射（导航事件、生命周期事件）
- **禁止**：RPC 调用、嵌套 webview 标签创建
- **保留**：loadURL、goBack、goForward 等导航控制

### 5.2 进程隔离

- Bun 主进程运行在 Web Worker 中
- Browser 渲染进程通过 FFI 和 postMessage 通信
- RPC 通信加密且类型安全
- 自定义 `views://` schema 加载打包资源

### 5.3 Session 隔离

通过 Partition 机制隔离浏览器会话（Cookie、Storage 等）：

- 临时分区：`partition1`（应用关闭即清除）
- 持久分区：`persist:partition1`（跨重启保持）

## 六、工具与实用 API

### 6.1 Utils 模块

| 功能       | 方法                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| 文件管理   | `moveToTrash`, `showItemInFolder`, `openPath`                                          |
| 外部链接   | `openExternal`                                                                         |
| 系统通知   | `showNotification`                                                                     |
| 文件对话框 | `openFileDialog`                                                                       |
| 消息框     | `showMessageBox`                                                                       |
| 剪贴板     | `clipboardReadText`, `clipboardWriteText`, `clipboardReadImage`, `clipboardWriteImage` |
| 应用控制   | `quit`, `setDockIconVisible`                                                           |
| 路径管理   | `Utils.paths.*`（home, downloads, userData 等）                                        |

### 6.2 Screen 模块

- `getPrimaryDisplay()` - 主显示器信息
- `getAllDisplays()` - 所有显示器信息
- `getCursorScreenPoint()` - 光标位置
- 支持 DPI 缩放因子、工作区域计算

## 七、优缺点分析

### 优势

1. **极致性能**：<50ms 启动，14MB 体积，14KB 更新
2. **纯 TypeScript**：无需学习 Rust，前后端统一语言
3. **Bun 生态**：内置打包器、极快的运行时
4. **灵活渲染**：系统 WebView + 可选 CEF
5. **内置更新**：BSDIFF 二进制差分，无需服务器
6. **类型安全 RPC**：端到端类型安全的进程间通信
7. **跨平台**：macOS、Windows、Linux

### 劣势/风险

1. **项目成熟度**：较新项目，生态和社区仍在成长
2. **Windows/Linux 支持有限**：部分功能（深链接、某些平台特性）尚未支持
3. **系统 WebView 兼容性**：不同系统 WebView 版本差异可能导致渲染不一致
4. **CEF 体积**：打包 CEF 增加约 100MB+
5. **调试工具**：开发工具链可能不如 Electron 成熟
6. **学习曲线**：Bun 运行时 + 自定义架构需要学习

### 适用场景

| 场景              | 推荐度   | 说明                        |
| ----------------- | -------- | --------------------------- |
| MVP / 快速原型    | 非常适合 | 极快的构建和部署速度        |
| 开发者工具        | 非常适合 | 原生性能、小体积            |
| 跨平台应用        | 适合     | 一套代码、原生体验          |
| 高频更新应用      | 非常适合 | KB 级更新包                 |
| 多标签浏览器      | 适合     | 支持 OOPIF、混合 CEF/WebKit |
| 需要完整 Chromium | 一般     | 可选 CEF 但增加体积         |

## 八、与 Electron 的迁移考量

如果考虑从 Electron 迁移到 Electrobun：

1. **Node.js API**：Electron 的 `ipcMain/ipcRenderer` 需要迁移到 Electrobun 的 RPC 机制
2. **窗口管理**：API 概念相似但接口不同
3. **打包工具**：从 electron-builder 迁移到 electrobun CLI
4. **preload 脚本**：机制类似但 API 不同
5. **系统菜单**：API 设计理念相似

## 九、总结

Electrobun 代表了桌面应用开发的一个新方向——在保持 Web 技术开发便利性的同时，通过 Bun 运行时、系统 WebView 和精细的架构设计实现了远超 Electron 的性能表现。其 14MB 的打包体积和 14KB 的更新包大小对于需要频繁更新的应用尤其具有吸引力。

然而，作为相对年轻的项目，Electrobun 在 Windows/Linux 平台的完整性、社区生态和长期稳定性方面仍有待验证。建议在以下情况优先考虑 Electrobun：

- 对应用体积和启动速度有极高要求
- 团队熟悉 TypeScript，不想引入 Rust
- 需要高频更新且对带宽成本敏感
- 应用场景以 macOS 为主

---

_报告生成日期：2026-03-28_
_参考文档：https://blackboard.sh/electrobun/docs/_
