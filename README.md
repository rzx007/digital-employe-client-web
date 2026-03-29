# 数字员工客户端

AI 驱动的数字员工平台，包含 Web 前端仪表盘和智能代理后端服务。

## 项目结构

- `apps/web` - 主前端应用（React 19 + TypeScript，Vite，TanStack Router，AI SDK）
- `apps/simple-agents` - AI 代理服务器（Bun，Hono，LangChain，Drizzle ORM）
- `packages/ui` - 共享 UI 组件库（Radix UI，Tailwind CSS，shadcn/ui）

## 技术栈

**前端 (apps/web)**

- React 19 + TypeScript
- Vite + Turbo
- TanStack Router - 文件路由
- TanStack Query - 服务端状态管理
- AI SDK - 聊天/代理功能
- Zustand - 客户端状态管理

**后端 (apps/simple-agents)**

- Bun + Hono
- LangChain - AI 代理编排
- Drizzle ORM - 数据库操作

**UI 组件 (packages/ui)**

- Radix UI 原语
- Tailwind CSS v4
- shadcn/ui 模式

## 快速开始

### 环境要求

- [Bun](https://bun.sh/) >= 1.0

### 安装依赖

```bash
bun install
```

### 开发模式

```bash
# 启动所有包
turbo dev

# 仅启动 Web 前端
turbo dev --filter=web

# 仅启动代理服务器
turbo dev --filter=simple-agents
```

## 开发命令

```bash
# 构建所有包
turbo build

# 代码检查
turbo lint

# 代码格式化
turbo format

# 类型检查
turbo typecheck

# 对特定包执行命令
turbo lint --filter=web
turbo build --filter=@workspace/ui
```

## 添加 UI 组件

在 `apps/web` 根目录运行以下命令添加组件：

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

组件将被放置在 `packages/ui/src/components` 目录。

## 使用组件

从 `ui` 包导入组件：

```tsx
import { Button } from "@workspace/ui/components/button"
```
