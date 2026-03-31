# shadcn/ui monorepo template

This is a Vite monorepo template with shadcn/ui.

## Adding components

To add components to your app, run the following command at the root of your `web` app:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

This will place the ui components in the `packages/ui/src/components` directory.

## Using components

To use the components in your app, import them from the `ui` package.

```tsx
import { Button } from "@workspace/ui/components/button";
```

## 纯 Web 开发（日常使用）

```bash
# 终端 1：启动 simple-agents
cd apps/simple-agents && pnpm dev
```
```bash
# 终端 2：启动前端
cd apps/web && pnpm dev
```

> 前端通过 vite proxy /simple-agents → localhost:3005 调用后端 API。better-sqlite3 使用 Node 22 ABI (127)。

## Electron 开发

```bash
# 1. 确保 simple-agents 已编译
cd apps/simple-agents && pnpm build

# 2. 为 Electron ABI 重新编译 better-sqlite3
cd apps/web && pnpm rebuild

# 3. 启动 Electron
cd apps/web && pnpm dev:app
```

> Electron 主进程加载 simple-agents/dist/app.js（编译后 JS），better-sqlite3 使用 Electron ABI (143)。

## Electron 打包

```bash
cd apps/web && pnpm build:app
```

electron-builder 自动 npmRebuild，打包后的应用自带正确 ABI 的 better-sqlite3。

## 切换模式

每次从 Electron 模式切回纯 Web 开发时，需要：

```bash
pnpm install   # pnpm 会重新下载 Node 22 ABI 的 better-sqlite3
```