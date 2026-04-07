# Subagents 研究报告 & 群聊员工子代理化设计方案

> 基于项目代码分析，生成于 2026-03-30

---

## 目录

1. [项目架构概览](#1-项目架构概览)
2. [DeepAgents Subagent 机制深度分析](#2-deepagents-subagent-机制深度分析)
3. [当前项目 Agent 实现现状](#3-当前项目-agent-实现现状)
4. [群聊系统现状分析](#4-群聊系统现状分析)
5. [核心差距分析](#5-核心差距分析)
6. [群聊员工子代理化 — 总体设计方案](#6-群聊员工子代理化--总体设计方案)
7. [方案 A：Orchestrator-Delegate 模式（推荐）](#7-方案-aorchestrator-delegate-模式推荐)
8. [方案 B：Round-Robin 顺序响应模式](#8-方案-bround-robin-顺序响应模式)
9. [方案 C：Supervisor 评审模式](#9-方案-csupervisor-评审模式)
10. [数据模型变更](#10-数据模型变更)
11. [后端实现路线图](#11-后端实现路线图)
12. [前端适配方案](#12-前端适配方案)
13. [流式输出与 UI 展示](#13-流式输出与-ui-展示)
14. [关键风险与对策](#14-关键风险与对策)

---

## 1. 项目架构概览

本项目是一个 **数字员工 AI Agent 平台**，采用 Monorepo 架构：

```
digital-employe-client-web/
├── apps/
│   ├── simple-agents/    # 后端：Hono + Drizzle ORM + SQLite + DeepAgents (LangGraph)
│   └── web/              # 前端：React 19 + TanStack Router + AI SDK + Tailwind CSS
├── packages/
│   └── ui/               # 共享 UI 组件库 (Radix UI + shadcn/ui)
└── docs/
```

**核心数据流：**

```
用户 → Web 前端 (useChat) → Vite Proxy → simple-agents 后端
  → createDeepAgent (DeepAgents/LangGraph) → GLM-4.7 模型
  → SSE 流式响应 → 前端实时渲染
```

**Agent 生命周期：**

```
员工(Employee) → Agent 工厂(getAgent) → 缓存(Map<employeeId, DeepAgent>)
  ↓ 配置变更时
invalidateAgentCache(employeeId) → 下次请求重建
```

每个员工对应一个独立的 Agent 实例，拥有独立的：

- `systemPrompt`（系统提示词）
- `skills`（技能集：全局技能 + 员工专属技能）
- `capabilities`（能力列表：MCP 工具映射）

---

## 2. DeepAgents Subagent 机制深度分析

### 2.1 什么是 Subagent

DeepAgents（v1.8.6）基于 LangGraph 构建，内置了一套 **子代理（Subagent）系统**。主 Agent 可以通过 `task` 工具将复杂任务委派给专门的子代理执行。

**类比理解：** 主 Agent 是"项目经理"，子代理是"专业工程师"。项目经理自己不直接干技术活，而是把不同专业领域的任务分配给对应工程师。

### 2.2 Subagent 配置接口

```typescript
// SubAgent 定义（来自 deepagents/dist/index.d.ts）
interface SubAgent {
  name: string // 子代理名称（用于 task 工具选择）
  description: string // 子代理能力描述（展示给主 Agent 用于决策）
  systemPrompt: string // 子代理专属系统提示词
  tools?: StructuredTool[] // 子代理可用的工具（默认继承主 Agent 工具）
  model?: LanguageModelLike | string // 子代理使用的模型（默认继承）
  middleware?: readonly AgentMiddleware[] // 子代理中间件
  skills?: string[] // 子代理专属技能路径（不继承主 Agent 技能）
  responseFormat?: CreateAgentParams["responseFormat"]
}
```

### 2.3 子代理创建流程

```
createDeepAgent({
  model,
  systemPrompt: "你是协调员...",
  subagents: [
    {
      name: "researcher",
      description: "负责信息搜索和研究分析",
      systemPrompt: "你是研究助理...",
      tools: [webSearch],
    },
    {
      name: "coder",
      description: "负责代码生成和编程任务",
      systemPrompt: "你是代码专家...",
      tools: [codeGenerator],
    },
  ],
})
```

**内部执行过程：**

1. `createDeepAgent` 解析 `subagents` 数组
2. 通过 `createSubAgentMiddleware()` 为每个子代理创建独立的 LangGraph Agent
3. 注册 `task` 工具，其 schema 包含所有可用子代理的 `name` 和 `description`
4. 主 Agent 的 system prompt 自动追加 `TASK_SYSTEM_PROMPT`，指导主 Agent 何时及如何使用子代理

### 2.4 task 工具工作机制

主 Agent 调用 `task` 工具时：

```
task({
  description: "搜索 TypeScript 5.0 的新特性",
  subagent_type: "researcher"
})
```

**执行流程：**

```
1. 主 Agent 决定使用 task 工具
   ↓
2. 选择子代理类型 (subagent_type: "researcher")
   ↓
3. 将当前 state 过滤（去掉内部字段）
   ↓
4. 创建新的 HumanMessage(description) 作为子代理的输入
   ↓
5. 子代理在自己的 LangGraph 图中独立运行
   ↓
6. 子代理返回结果（字符串或 Command）
   ↓
7. 结果合并回主 Agent 的对话上下文
   ↓
8. 主 Agent 综合结果生成最终回复
```

### 2.5 General-Purpose 子代理

即使不显式配置 `subagents`，DeepAgents 也会自动创建一个 `general-purpose` 子代理：

```typescript
// 自动创建的通用子代理
{
  name: "general-purpose",
  systemPrompt: DEFAULT_SUBAGENT_PROMPT,
  tools: /* 继承主 Agent 所有工具 */,
  middleware: /* 包含主 Agent 的 skills */,
}
```

可以通过提供 `name: "general-purpose"` 的自定义子代理来覆盖它。

### 2.6 子代理继承规则


| 属性         | 自定义子代理      | general-purpose 子代理 |
| ---------- | ----------- | ------------------- |
| 父 Agent 工具 | 继承（可覆盖）     | 继承                  |
| 父 Agent 技能 | **不继承**     | 继承                  |
| 父 Agent 模型 | 继承（可覆盖）     | 继承                  |
| 中间件        | 基础中间件 + 自定义 | 基础中间件 + 父 skills    |


**基础中间件包含：** `todoListMiddleware` + `FilesystemMiddleware` + `SummarizationMiddleware` + `PatchToolCallsMiddleware`

### 2.7 子代理的上下文隔离

子代理运行在独立的 LangGraph 图中，但通过以下方式与主 Agent 共享上下文：

- **输入继承：** 子代理接收主 Agent 过滤后的 state（不包含内部字段）
- **运行时配置传播：** 通过 LangChain 的 `config` 对象传播（包括 `thread_id`）
- **FilesystemBackend 共享：** 如果使用相同的 `thread_id`，子代理可以访问同一会话目录的文件
- **输出合并：** 子代理的最终消息内容作为 task 工具的返回值，合并回主对话

### 2.8 现有示例代码

项目中已有子代理示例（`apps/simple-agents/examples/04-subagents.ts`）：

```typescript
const agent = createDeepAgent({
  model,
  tools: [webSearch, codeGenerator],
  subagents: [
    {
      name: "researcher",
      description: "专业的研究助理，用于搜索和总结信息",
      systemPrompt: `你是一个专业的研究助理...
        工作流程：
        1. 使用 web_search 搜索相关信息
        2. 分析和总结搜索结果
        3. 返回简洁的研究报告`,
      tools: [webSearch],
    },
    {
      name: "coder",
      description: "代码生成专家",
      systemPrompt: `你是一个代码生成专家...`,
      tools: [codeGenerator],
    },
  ],
  systemPrompt: `你是一个项目协调员，负责管理专业化子代理。
    你有两个子代理可用：researcher、coder
    根据用户需求，使用 task 工具将任务委派给合适的子代理。`,
})
```

---

## 3. 当前项目 Agent 实现现状

### 3.1 Agent 工厂（`apps/simple-agents/src/agent.ts`）

当前 Agent 创建方式：

```typescript
export function getAgent(employeeId: string, systemPrompt?: string): any {
  if (agentCache.has(employeeId)) return agentCache.get(employeeId)

  const agent = createDeepAgent({
    model,
    systemPrompt: prompt,
    skills: ["/skills/", "/employee-skills/"],
    backend: (runtime) => {
      const threadId = runtime.configurable?.thread_id || "default"
      return new FilesystemBackend({
        rootDir: getSessionDir(threadId),
        virtualMode: true,
      })
    },
    // ⚠️ 未配置 subagents
  })

  agentCache.set(employeeId, agent)
  return agent
}
```

**关键发现：**

- 每个 Agent 实例按 `employeeId` 缓存
- 使用 `FilesystemBackend` 做会话级文件隔离
- 使用 `SkillsMiddleware` 做技能渐进式加载
- **没有配置任何 subagents**，只有默认的 `general-purpose` 子代理

### 3.2 对话服务（`apps/simple-agents/src/services/agent-service.ts`）

```typescript
async function resolveAgent(employeeId?: string) {
  const cacheKey = employeeId || "__default__"
  let systemPrompt: string | undefined

  if (employeeId) {
    const emp = await getEmployee(employeeId)
    systemPrompt = emp?.systemPrompt || undefined
  }

  return getAgent(cacheKey, systemPrompt)
}
```

**关键发现：**

- `resolveAgent` 只能解析单个 `employeeId`
- 没有任何群聊/多 Agent 协调逻辑
- Agent 实例生命周期：按 `employeeId` 缓存，配置变更时失效

### 3.3 缓存架构

```
agentCache (Map<employeeId, DeepAgent>)
├── "9368" → DeepAgent (AI调度员-监测员)
├── "9351" → DeepAgent (技术支持客服)
├── "1"    → DeepAgent (电力市场交易专家)
└── "__default__" → DeepAgent (默认助手)
```

每个缓存的 Agent 实例是**独立的**，彼此之间没有通信机制。

---

## 4. 群聊系统现状分析

### 4.1 数据模型

```sql
-- groups 表（独立表，无外键关联）
groups (
  id          TEXT PRIMARY KEY,  -- nanoid
  name        TEXT NOT NULL,
  employee_ids TEXT NOT NULL DEFAULT '[]',  -- JSON 字符串数组 ["1", "3", "5"]
  created_at  TEXT,
  updated_at  TEXT
)

-- sessions 表（关联单个 employee）
sessions (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  employee_id TEXT,        -- ⚠️ 单个员工 ID，无 group_id 字段
  metadata    TEXT,
  is_archived INTEGER,
  created_at  TEXT,
  updated_at  TEXT
)
```

**核心问题：** `groups` 和 `sessions` 之间没有关联关系。`sessions.employee_id` 只支持单个员工。

### 4.2 群聊 API 层


| 端点                       | 状态      | 说明                  |
| ------------------------ | ------- | ------------------- |
| `POST /api/groups`       | 已实现     | 创建群聊（存 employeeIds） |
| `GET /api/groups`        | 已实现     | 列出群聊                |
| `GET /api/groups/:id`    | 已实现     | 获取群聊详情              |
| `PATCH /api/groups/:id`  | 已实现     | 更新群聊                |
| `DELETE /api/groups/:id` | 已实现     | 删除群聊                |
| 群聊消息发送                   | **未实现** | 无群聊 session 和消息机制   |
| 群聊 Agent 调度              | **未实现** | 无多 Agent 协调逻辑       |


### 4.3 前端群聊现状

```
通讯录侧边栏 (contacts-sidebar.tsx)
├── 主理人 (curator) → "开发中.."
├── 群聊列表
│   └── 可以创建群聊，选择员工 → 创建成功
└── 员工列表
    └── 点击员工 → 创建/进入会话 → 正常聊天

群聊会话流程：
1. 用户创建群聊 → POST /api/groups → 成功
2. 用户点击群聊联系人 → 视图切换到 DraftChatView
3. 用户发送消息 → createConversation() 被调用
4. getEmployeeIdFromContact() 对 group 类型返回 null
5. createSessionApi(title, undefined) → 创建无 employeeId 的 session
6. POST /api/sessions/{id}/chat/stream → 使用 __default__ Agent 响应
   ⚠️ 所有群聊消息都由同一个默认 Agent 处理，群内员工 Agent 未参与
```

### 4.4 外部管理 API 中的群聊定义

管理后端 API（`数字员工客户端接口文档V0.1.md`）中已定义了群聊聊天接口：

```json
POST /chat/conversations
{
  "workspace_id": 2,
  "target_type": "group",    // 支持 "employee" 和 "group"
  "target_id": 8,            // 员工或组 ID
  "title": "测试群聊"
}
```

但 **simple-agents 后端完全没有实现 `target_type: "group"` 的逻辑**。

---

## 5. 核心差距分析


| 维度       | 当前状态                    | 目标状态               | 差距                |
| -------- | ----------------------- | ------------------ | ----------------- |
| 数据模型     | sessions 只关联单个 employee | sessions 可关联 group | 需要增加 group_id 字段  |
| Agent 创建 | 每个员工独立 Agent 实例         | 群聊场景需要编排多 Agent    | 需要群聊级别的 Agent 编排器 |
| 消息路由     | 单 Agent 处理所有消息          | 消息需要路由到群内多个 Agent  | 需要消息分发机制          |
| 流式输出     | 单 Agent 单流              | 多 Agent 可能需要多流合并   | 需要流合并/顺序展示        |
| 上下文共享    | 无                       | 群内 Agent 需要共享对话上下文 | 需要上下文传递机制         |
| 前端 UI    | 群聊无特殊展示                 | 区分不同 Agent 的回复     | 需要 Agent 标识和头像展示  |
| 会话历史     | 单 Agent 消息列表            | 多 Agent 混合消息列表     | 需要消息关联 Agent 身份   |


---

## 6. 群聊员工子代理化 — 总体设计方案

### 6.1 核心思路

**将群聊中的每个员工 Agent 注册为 DeepAgents 的 SubAgent，由一个 Orchestrator Agent 统一调度。**

```
┌─────────────────────────────────────────────┐
│              用户发送消息到群聊                │
│           "帮我分析一下电网负荷数据"            │
└──────────────────────┬──────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│          Orchestrator Agent（编排器）          │
│  systemPrompt: "你是群聊协调员，负责..."        │
│                                              │
│  可用子代理（task 工具）：                      │
│  ├─ "AI调度员（监测员）": 数据监测、母线失电    │
│  ├─ "电力市场分析师": 市场分析、负荷转供        │
│  └─ "检修计划协调员": 日检修计划、交接班记录    │
│                                              │
│  → 决策：将"负荷数据"分析委派给监测员            │
│  → 调用 task(description, subagent_type)     │
└──────────┬───────────────────────────────────┘
           ▼
┌──────────────────────────────────────────────┐
│       SubAgent: "AI调度员（监测员）"            │
│  systemPrompt: 原员工专属 systemPrompt         │
│  tools: [数据监测, 母线失电]                   │
│  skills: [监测员专属技能]                       │
│  → 独立运行，返回分析结果                       │
└──────────┬───────────────────────────────────┘
           ▼
┌──────────────────────────────────────────────┐
│          Orchestrator Agent                   │
│  收到子代理结果 → 综合分析 → 可能继续委派       │
│  → 生成最终回复："根据监测员的分析..."           │
└──────────────────────────────────────────────┘
```

### 6.2 方案选型矩阵


| 维度              | 方案 A: Orchestrator-Delegate | 方案 B: Round-Robin | 方案 C: Supervisor   |
| --------------- | --------------------------- | ----------------- | ------------------ |
| 编排方式            | 主 Agent 智能委派                | 顺序让每个 Agent 响应    | 主 Agent + 评审 Agent |
| 上下文共享           | 通过 task 工具自动传递              | 每轮手动拼接            | 两轮：先执行后评审          |
| 灵活性             | 高（AI 自主决策）                  | 低（固定轮转）           | 中等                 |
| 复杂度             | 中等                          | 低                 | 高                  |
| Token 消耗        | 中等（主 Agent + 子 Agent）       | 高（每个 Agent 都跑）    | 高（主 + 子 + 评审）      |
| 适用场景            | 复杂协作、任务分发                   | 简单信息收集、投票         | 质量敏感、需二次验证         |
| 与 DeepAgents 适配 | **原生支持**                    | 需要自定义实现           | 需要自定义实现            |
| 推荐指数            | ★★★★★                       | ★★★☆☆             | ★★★★☆              |


---

## 7. 方案 A：Orchestrator-Delegate 模式（推荐）

### 7.1 架构设计

这是与 DeepAgents Subagent 机制**最原生匹配**的方案。

```
群聊会话 (group chat session)
│
├── Orchestrator Agent（动态创建）
│   ├── systemPrompt: 动态生成（包含群内员工信息）
│   ├── tools: []（编排器通常不需要额外工具）
│   ├── subagents: [
│   │     {
│   │       name: "员工A-ID",
│   │       description: "员工A的能力描述",
│   │       systemPrompt: "员工A的原始 systemPrompt + 群聊上下文",
│   │       tools: 员工A的能力工具,
│   │       skills: ["/employee-skills-A/"]
│   │     },
│   │     {
│   │       name: "员工B-ID",
│   │       description: "员工B的能力描述",
│   │       ...
│   │     },
│   │   ]
│   └── backend: 共享群聊会话目录
│
└── 流式输出 → SSE → 前端
```

### 7.2 核心实现：群聊 Agent 工厂

```typescript
// apps/simple-agents/src/services/group-agent-service.ts

import { createDeepAgent, FilesystemBackend, type SubAgent } from "deepagents"
import { getGroup } from "./group-service"
import { getEmployee } from "./employee-service"
import { getSessionDir } from "../agent"
import { model } from "../agent"

const groupAgentCache = new Map<string, any>()

function buildOrchestratorPrompt(
  groupName: string,
  employees: Array<{
    name: string
    description: string
    capabilities: Array<{ capability_name: string; capability_desc: string }>
  }>
): string {
  const memberList = employees
    .map((emp, i) => {
      const caps = emp.capabilities
        .map((c) => `  - ${c.capability_name}: ${c.capability_desc}`)
        .join("\n")
      return `${i + 1}. **${emp.name}**\n   ${emp.description || ""}\n   能力：\n${caps}`
    })
    .join("\n\n")

  return `你是一个群聊协调员（Orchestrator），负责管理"${groupName}"群组中的多位 AI 员工。

## 群组成员
${memberList}

## 工作方式
1. 分析用户的消息，判断需要哪些成员参与
2. 使用 task 工具将任务委派给最合适的成员
3. 可以依次委派多个成员，也可以并行委派独立任务
4. 收集所有成员的结果后，综合整理成完整的回复
5. 如果某个成员的结果需要另一个成员补充，可以继续委派

## 注意事项
- 每次委派时，description 要清晰说明任务目标和期望输出
- 只委派给有相关能力的成员
- 综合回复时标注信息来源
- 始终用中文回复`
}

export async function getGroupAgent(
  groupId: string,
  threadId: string
): Promise<any> {
  const cacheKey = `group:${groupId}`
  if (groupAgentCache.has(cacheKey)) {
    return groupAgentCache.get(cacheKey)
  }

  const group = await getGroup(groupId)
  if (!group) throw new Error(`Group ${groupId} not found`)

  const employeeIds = JSON.parse(group.employeeIds || "[]") as string[]

  const subagents: SubAgent[] = []
  const employeesInfo: Array<{
    name: string
    description: string
    capabilities: any[]
  }> = []

  for (const empId of employeeIds) {
    const emp = await getEmployee(empId)
    if (!emp) continue

    employeesInfo.push({
      name: emp.name,
      description: emp.description || "",
      capabilities: JSON.parse(emp.capabilities || "[]"),
    })

    subagents.push({
      name: `employee-${emp.id}`,
      description: buildEmployeeDescription(emp),
      systemPrompt: emp.systemPrompt || "",
      skills: ["/employee-skills/"],
    })
  }

  const orchestratorPrompt = buildOrchestratorPrompt(group.name, employeesInfo)

  const agent = createDeepAgent({
    model,
    systemPrompt: orchestratorPrompt,
    subagents,
    backend: () =>
      new FilesystemBackend({
        rootDir: getSessionDir(threadId),
        virtualMode: true,
      }),
  })

  groupAgentCache.set(cacheKey, agent)
  return agent
}

function buildEmployeeDescription(emp: any): string {
  const capabilities = JSON.parse(emp.capabilities || "[]") as Array<{
    capability_name: string
    capability_desc: string
  }>
  const capList = capabilities
    .map((c) => `${c.capability_name}(${c.capability_desc})`)
    .join("、")

  return `${emp.name}：${emp.description || capList}`
}

export function invalidateGroupAgentCache(groupId?: string): void {
  if (groupId) {
    groupAgentCache.delete(`group:${groupId}`)
  } else {
    groupAgentCache.clear()
  }
}
```

### 7.3 群聊会话创建

```typescript
// 扩展 session-service.ts

export async function createGroupSession(
  groupId: string,
  title: string
): Promise<Session> {
  const id = nanoid()

  const [session] = await db
    .insert(sessions)
    .values({
      id,
      title,
      employeeId: null, // 群聊不关联单个员工
      metadata: JSON.stringify({ groupId }),
    })
    .returning()

  const sessionDir = getSessionDir(id)

  // 获取群聊成员信息，为每个员工创建技能链接
  const group = await getGroup(groupId)
  const employeeIds = JSON.parse(group?.employeeIds || "[]") as string[]

  for (const empId of employeeIds) {
    await linkEmployeeSkills(sessionDir, empId)
  }

  await linkGlobalSkills(sessionDir)

  return session
}
```

### 7.4 群聊消息路由

```typescript
// 扩展 chat 路由

app.post("/:id/chat/stream", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<SendMessageInput>()
  const session = await getSession(id)
  if (!session) return c.json({ error: "Session not found" }, 404)

  const metadata = JSON.parse(session.metadata || "{}")

  // 判断是群聊会话还是单人会话
  if (metadata.groupId) {
    // 群聊模式：使用 GroupAgent
    return await groupChatStreamResponse(id, body.message, metadata.groupId)
  }

  // 单人模式：使用原有逻辑
  const employeeId = session.employeeId || undefined
  return await chatStreamResponse(id, body.message, employeeId)
})
```

### 7.5 群聊流式响应

```typescript
// apps/simple-agents/src/services/group-agent-service.ts (续)

export async function groupChatStreamResponse(
  sessionId: string,
  userMessage: string,
  groupId: string
): Promise<Response> {
  await createMessage(sessionId, "user", userMessage, {
    parts: [{ type: "text", text: userMessage }],
  })

  const agent = await getGroupAgent(groupId, sessionId)

  const config = { configurable: { thread_id: sessionId } }
  const history = await getSessionMessages(sessionId)
  const langchainMessages = toLangchainMessages(history)

  const eventStream = agent.streamEvents(
    { messages: langchainMessages as any },
    config
  )

  const uiStream = toUIMessageStream(eventStream)

  const managedStream = createUIMessageStream({
    execute({ writer }) {
      writer.merge(uiStream)
    },
    onFinish: async ({ responseMessage }) => {
      await persistAssistantMessage(sessionId, responseMessage)
    },
  })

  return createUIMessageStreamResponse({ stream: managedStream })
}
```

---

## 8. 方案 B：Round-Robin 顺序响应模式

### 8.1 设计思路

每个群聊成员**依次**对用户消息做出响应，模拟群聊中多人讨论的场景。

```
用户: "今天电网运行情况如何？"
  ↓
员工A (监测员): "根据监测数据，110kV 线路负荷正常..."
  ↓
员工B (分析师): "从市场角度，今日现货价格..."
  ↓
员工C (协调员): "综合以上信息，检修计划如下..."
  ↓
最终回复: 合并展示所有员工的回复
```

### 8.2 实现要点

```typescript
export async function roundRobinChatStreamResponse(
  sessionId: string,
  userMessage: string,
  groupId: string
): Promise<Response> {
  const group = await getGroup(groupId)
  const employeeIds = JSON.parse(group?.employeeIds || "[]") as string[]

  // 依次调用每个员工 Agent
  const results: Array<{ employeeId: string; content: string }> = []

  for (const empId of employeeIds) {
    const agent = await resolveAgent(empId)
    const emp = await getEmployee(empId)

    const history = await getSessionMessages(sessionId)
    const langchainMessages = toLangchainMessages(history)

    const result = await agent.invoke(
      { messages: langchainMessages as any },
      { configurable: { thread_id: `${sessionId}_${empId}` } }
    )

    const lastMsg = result.messages[result.messages.length - 1]
    results.push({
      employeeId: empId,
      content:
        typeof lastMsg.content === "string"
          ? lastMsg.content
          : JSON.stringify(lastMsg.content),
    })

    // 保存每个员工的回复
    await createMessage(
      sessionId,
      "assistant",
      results[results.length - 1].content,
      {
        parts: [{ type: "text", text: results[results.length - 1].content }],
        metadata: JSON.stringify({
          employeeId: empId,
          employeeName: emp?.name,
        }),
      }
    )
  }

  // 返回合并后的流式响应
  // ... (需要自定义流式逻辑将多个结果依次发送)
}
```

### 8.3 优缺点

- 优点：实现简单，每个员工都有发言机会
- 缺点：不智能，所有员工都必须响应（即使与问题无关），Token 消耗大
- 适用：信息收集、头脑风暴、投票决策

---

## 9. 方案 C：Supervisor 评审模式

### 9.1 设计思路

在 Orchestrator-Delegate 基础上增加**评审环节**。主 Agent 委派子 Agent 后，再由一个"审核员"Agent 评审结果质量。

```
用户消息
  ↓
Orchestrator → task("监测员") → 监测员返回分析
  ↓
Orchestrator → task("审核员") → 审核员评审监测员结果
  ↓
Orchestrator → 综合 → 最终回复
```

### 9.2 实现要点

在 subagents 配置中增加一个 `reviewer` 子代理：

```typescript
const subagents: SubAgent[] = [
  ...employeeSubagents,
  {
    name: "reviewer",
    description: "审核员，负责审核其他成员的分析结果，确保准确性和完整性",
    systemPrompt: `你是一个质量审核员。你的职责是：
    1. 审查其他成员的分析结果是否准确
    2. 检查是否有遗漏的重要信息
    3. 标注需要修正的地方
    4. 给出改进建议`,
  },
]
```

### 9.3 优缺点

- 优点：输出质量更高，适合关键业务场景
- 缺点：额外一轮 Agent 调用，延迟更高，Token 消耗最大
- 适用：安全关键、合规要求高的场景（如电网调度指令）

---

## 10. 数据模型变更

### 10.1 sessions 表扩展

```sql
ALTER TABLE sessions ADD COLUMN group_id TEXT;
ALTER TABLE sessions ADD COLUMN metadata TEXT DEFAULT '{}';
```

Drizzle Schema 变更：

```typescript
// apps/simple-agents/src/db/schema.ts

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  employeeId: text("employee_id"), // 单人聊天：关联员工
  groupId: text("group_id"), // 群聊：关联群组 (新增)
  metadata: text("metadata"), // 扩展元数据 (新增)
  isArchived: integer("is_archived").default(0),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
})
```

### 10.2 messages 表扩展

为消息增加 `agentId` 和 `agentName` 字段，标识是哪个 Agent 的回复：

```sql
ALTER TABLE messages ADD COLUMN agent_id TEXT;
ALTER TABLE messages ADD COLUMN agent_name TEXT;
```

```typescript
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, {
      onDelete: "cascade",
    }),
  role: text("role").notNull(),
  content: text("content"),
  agentId: text("agent_id"), // 新增：Agent ID
  agentName: text("agent_name"), // 新增：Agent 显示名称
  parts: text("parts"),
  toolCalls: text("tool_calls"),
  toolResults: text("tool_results"),
  tokenCount: integer("token_count"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
})
```

### 10.3 前端类型扩展

```typescript
// apps/web/src/api/types.ts

export interface AgentMessage {
  id: number
  sessionId: string
  role: "user" | "assistant" | "system" | "tool"
  content: string | null
  agentId?: string // 新增：标识哪个 Agent 的回复
  agentName?: string // 新增：Agent 显示名称
  parts?: any
  toolCalls?: any
  toolResults?: any
  tokenCount?: number
  createdAt: string
}

export interface AgentSession {
  id: string
  title: string
  employeeId: string | null
  groupId?: string // 新增：群聊会话关联的群组
  metadata?: string
  isArchived: boolean
  createdAt: string
  updatedAt: string
}
```

---

## 11. 后端实现路线图

### Phase 1：数据层改造（1-2 天）

```
优先级：P0
依赖：无

任务：
□ sessions 表增加 group_id 字段
□ messages 表增加 agent_id, agent_name 字段
□ 编写数据库迁移脚本
□ 更新 Drizzle Schema 定义
□ 更新 session-service 支持群聊会话
□ 更新 message-service 支持带 Agent 标识的消息
```

### Phase 2：GroupAgent 核心服务（2-3 天）

```
优先级：P0
依赖：Phase 1

任务：
□ 创建 group-agent-service.ts
□ 实现 getGroupAgent(groupId, threadId) 工厂
□ 实现 buildOrchestratorPrompt() 动态提示词生成
□ 实现 groupChatStreamResponse() 群聊流式响应
□ 实现 groupChatSyncResponse() 群聊同步响应
□ 实现 invalidateGroupAgentCache() 缓存失效
□ 编写单元测试
```

### Phase 3：路由与 API 适配（1 天）

```
优先级：P0
依赖：Phase 2

任务：
□ 扩展 POST /api/sessions 支持创建群聊会话
□ 扩展 POST /api/sessions/:id/chat/stream 支持群聊路由
□ 扩展 POST /api/sessions/:id/chat 支持群聊同步路由
□ 扩展 POST /api/sessions/:id/chat/raw-stream 支持群聊
□ 更新 OpenAPI 文档
```

### Phase 4：前端适配（2-3 天）

```
优先级：P1
依赖：Phase 3

任务：
□ 更新 createConversation() 支持群聊会话创建
□ 更新 fetchConversationsByContactId() 支持群聊会话列表
□ 更新消息渲染组件展示 Agent 身份（名称、头像）
□ 群聊会话中的消息气泡区分不同 Agent
□ 群聊联系人类型传递到后端
```

### Phase 5：进阶功能（3-5 天）

```
优先级：P2
依赖：Phase 4

任务：
□ 实现群聊中的子代理调用过程可视化（展示 task 调用链）
□ 实现群聊成员动态增减（运行时修改 subagents）
□ 实现群聊历史对话中的 Agent 身份回溯
□ 实现 "指定回复" 功能（@某员工单独回复）
□ 考虑 raw-stream 模式下的多 Agent 事件追踪
```

---

## 12. 前端适配方案

### 12.1 会话创建适配

```typescript
// apps/web/src/api/chat.ts - 修改 createConversation

export async function createConversation(params: {
  contactId: string
  title?: string
  contact?: Contact
}): Promise<Conversation> {
  if (!params.contact || params.contact.type === "curator") {
    // ... 现有逻辑
  }

  // 群聊场景：传递 groupId
  if (params.contact.type === "group") {
    const groupId = params.contact.group?.id
    const session = await createSessionApi(
      params.title ?? "新对话",
      undefined, // employeeId 为空
      { groupId } // 新增：传递 groupId
    )
    return {
      id: session.id,
      title: session.title,
      contactId: params.contactId,
      updatedAt: new Date(session.updatedAt),
      unreadCount: 0,
    }
  }

  // 单人场景：现有逻辑不变
  const employeeId = getEmployeeIdFromContact(params.contact)
  const session = await createSessionApi(
    params.title ?? "新对话",
    employeeId ?? undefined
  )
  // ...
}
```

### 12.2 会话列表适配

```typescript
// apps/web/src/api/chat.ts - 修改 fetchConversationsByContactId

export async function fetchConversationsByContactId(
  contactId: string,
  contact?: Contact
): Promise<Conversation[]> {
  if (!contact || contact.type === "curator") return []

  if (contact.type === "group") {
    // 群聊会话列表：按 groupId 查询
    const groupId = contact.group?.id
    const items = await fetchSessionsByGroupIdApi(groupId)
    return items.map((session) => ({
      id: session.id,
      title: session.title,
      contactId,
      unreadCount: 0,
      updatedAt: new Date(session.updatedAt),
    }))
  }

  // 单人场景不变
  const employeeId = getEmployeeIdFromContact(contact)
  if (!employeeId) return []
  const items = await fetchSessionsApi(employeeId)
  // ...
}
```

### 12.3 消息展示适配

```typescript
// 群聊消息需要展示 Agent 身份

interface ChatMessageProps {
  message: Message
  isGroupChat: boolean
}

function MessageBubble({ message, isGroupChat }: ChatMessageProps) {
  // 群聊中展示 Agent 头像和名称
  return (
    <div className="flex gap-2">
      {isGroupChat && message.agentName && (
        <Avatar size="sm">
          <AvatarImage src={createDiceBearAvatar(message.agentId!)} />
        </Avatar>
      )}
      <div>
        {isGroupChat && message.agentName && (
          <span className="text-xs text-muted-foreground">
            {message.agentName}
          </span>
        )}
        <div className="prose">{message.content}</div>
      </div>
    </div>
  )
}
```

---

## 13. 流式输出与 UI 展示

### 13.1 当前的流式管线

```
agent.streamEvents()
  → toUIMessageStream()         // @ai-sdk/langchain
    → createUIMessageStream()   // AI SDK
      → SSE (UIMessageChunk)
        → 前端 useChat 解析渲染
```

### 13.2 群聊场景的流式挑战

使用方案 A（Orchestrator-Delegate）时，流式输出**不需要额外改造**：

```
Orchestrator Agent.streamEvents()
  │
  ├── on_chat_model_stream (Orchestrator 思考)
  ├── on_tool_start (task 工具调用开始)
  │     → 展示 "正在委派给监测员..."
  ├── on_chat_model_stream (子 Agent 输出)  ← 子 Agent 的 token 也被流式传出
  ├── on_tool_end (task 工具调用结束)
  │     → 展示 "监测员完成分析"
  ├── on_chat_model_stream (Orchestrator 综合)
  └── on_chain_end (完成)
```

DeepAgents 的 `streamEvents()` 会透传子代理的所有事件，因此前端可以接收完整的执行链。

### 13.3 建议的 UI 展示方式

```
┌─────────────────────────────────────────┐
│ 用户: 帮我分析一下今天的电网运行情况      │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 🔧 群聊协调员                            │
│                                         │
│ 我来安排相关专家为您分析：                 │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 📊 AI调度员（监测员）               │ │
│ │ ─────────────────────────          │ │
│ │ 根据实时监测数据：                   │ │
│ │ - 110kV 母线负荷 85% ✅ 正常        │ │
│ │ - 220kV 变压器温度 62°C ✅ 正常     │ │
│ │ - 10kV 配网故障 2 处 ⚠️ 待处理     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 📋 检修计划协调员                    │ │
│ │ ─────────────────────────          │ │
│ │ 针对 10kV 配网 2 处故障，建议：      │ │
│ │ - 故障1（XX线）：安排下午 14:00 检修  │ │
│ │ - 故障2（YY线）：安排明天 09:00 检修  │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 综合以上信息，当前电网运行总体稳定，      │
│ 建议...                                │
└─────────────────────────────────────────┘
```

### 13.4 进阶：子代理调用可视化

利用 raw-stream 模式的细粒度事件，可以实现"执行链"可视化：

```typescript
// 监听 raw-stream 事件
stream.on("tool_start", (event) => {
  if (event.toolName === "task") {
    // 展示 "正在委派任务给 AI调度员（监测员）..."
    showAgentInvocation({
      agentName: event.input.subagent_type,
      task: event.input.description,
      status: "running",
    })
  }
})

stream.on("tool_end", (event) => {
  // 展示 "AI调度员（监测员）完成分析"
  completeAgentInvocation({
    agentName: event.toolName,
    status: "completed",
  })
})
```

---

## 14. 关键风险与对策

### 14.1 性能风险


| 风险             | 影响                            | 对策                               |
| -------------- | ----------------------------- | -------------------------------- |
| 群聊 Agent 创建开销大 | 首次响应延迟高                       | 预热缓存：群聊创建时提前构建 Agent             |
| 多 Agent 串行执行   | 总耗时 = Orchestrator + Σ子 Agent | 支持并行 task 调用（DeepAgents 已支持）     |
| Token 消耗倍增     | API 成本上升                      | 限制子代理最大轮次；精简 orchestrator prompt |
| 大群聊（>10人）      | 子代理过多，选择困难                    | 限制群聊最大人数；优化 description 排序       |


### 14.2 质量风险


| 风险                    | 影响    | 对策                                           |
| --------------------- | ----- | -------------------------------------------- |
| Orchestrator 选择错误的子代理 | 回复质量差 | 优化 employee description；添加 negative examples |
| 子代理回复与上下文脱节           | 信息不连贯 | 在 task description 中包含完整上下文摘要                |
| 子代理幻觉编造信息             | 输出不可信 | 子代理继承员工能力约束；关键场景使用 Supervisor 模式             |


### 14.3 技术风险


| 风险                    | 影响            | 对策                                   |
| --------------------- | ------------- | ------------------------------------ |
| 群成员变更后缓存失效            | 使用旧 Agent 配置  | 群成员变更时调用 invalidateGroupAgentCache() |
| session metadata 解析失败 | 群聊路由到单人 Agent | 添加 fallback 逻辑和类型校验                  |
| 流式事件中子代理事件丢失          | 前端展示不完整       | 充分测试 streamEvents 透传行为               |


### 14.4 缓存策略建议

```
groupAgentCache (Map<"group:{groupId}", DeepAgent>)
│
├── 创建时机：群聊会话首次消息触发
├── 失效时机：
│   ├── 群成员增减 (updateGroup)
│   ├── 员工 systemPrompt 变更 (updateEmployee → invalidateAgentCache)
│   ├── 员工 skills 变更 (syncEmployeeSkills)
│   └── 服务重启（内存缓存自动清空）
├── 替代策略：考虑引入 LRU + TTL 自动过期
└── 预热策略：群聊创建时异步预构建 Agent
```

---

## 附录 A：关键文件索引


| 文件                                                    | 说明            |
| ----------------------------------------------------- | ------------- |
| `apps/simple-agents/src/agent.ts`                     | Agent 工厂，缓存管理 |
| `apps/simple-agents/src/services/agent-service.ts`    | 单人聊天服务        |
| `apps/simple-agents/src/services/group-service.ts`    | 群聊 CRUD 服务    |
| `apps/simple-agents/src/services/agent-stream-raw.ts` | 原始流式服务        |
| `apps/simple-agents/src/services/stream-registry.ts`  | 流式任务管理器       |
| `apps/simple-agents/src/db/schema.ts`                 | 数据库 Schema    |
| `apps/simple-agents/src/routes/chat.ts`               | 聊天路由          |
| `apps/simple-agents/src/routes/groups.ts`             | 群聊路由          |
| `apps/simple-agents/examples/04-subagents.ts`         | 子代理使用示例       |
| `apps/web/src/api/chat.ts`                            | 前端聊天 API 层    |
| `apps/web/src/api/group.ts`                           | 前端群聊 API      |
| `apps/web/src/api/types.ts`                           | 类型定义          |
| `apps/web/src/components/chat/contacts-sidebar.tsx`   | 通讯录侧边栏        |
| `apps/web/src/components/chat/chat-draft-view.tsx`    | 新对话视图         |


## 附录 B：外部管理 API 群聊接口（已定义未实现）

```json
POST /workspaces/{workspace_id}/groups     // 创建群聊
GET  /workspaces/{workspace_id}/groups     // 群聊列表
GET  /groups/{group_id}                    // 群聊详情
DELETE /groups/{group_id}                  // 删除群聊

POST /chat/conversations                   // 创建聊天
  body: { target_type: "group", target_id: groupId }
GET  /chat/conversations/{id}/stream       // 聊天流式
```

## 附录 C：DeepAgents SubAgent 接口参考

```typescript
// 来自 deepagents v1.8.6
interface SubAgent {
  name: string                                    // 子代理标识
  description: string                             // 能力描述
  systemPrompt: string                            // 系统提示词
  tools?: StructuredTool[]                        // 可用工具
  model?: LanguageModelLike | string              // 模型
  middleware?: readonly AgentMiddleware[]         // 中间件
  interruptOn?: Record<string, boolean | InterruptOnConfig>
  skills?: string[]                               // 专属技能路径
  responseFormat?: CreateAgentParams["responseFormat"]
}

interface CompiledSubAgent<TRunnable extends ReactAgent<any> | Runnable> {
  name: string
  description: string
  runnable: TRunnable                             // 预编译的 LangGraph 图
}

// createDeepAgent 中 subagents 参数类型
subagents?: (SubAgent | CompiledSubAgent)[]
```

