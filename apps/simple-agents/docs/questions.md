## Questions 工具 + 工具确认 集成方案

> **文档状态**：本文档为设计方案，**尚未实施**。以下基于 2026-04-05 的代码实际状态进行了全面校准。

---

## 一、当前项目实际状态（截至 2026-04-05）

### 1.1 后端 `apps/simple-agents/` 已完成功能

| 模块 | 状态 | 说明 |
|---|---|---|
| Agent 工厂 + 缓存 | ✅ 已实现 | `src/agent.ts` — 按 `employeeId` 缓存 `createDeepAgent` 实例，`FilesystemBackend` 虚拟模式，技能路径 `["/skills/", "/employee-skills/"]` |
| 同步对话 | ✅ 已实现 | `src/services/agent-service.ts` — `chat()` 函数，`agent.invoke()` 阻塞式调用 |
| AI SDK 流式对话 (SDK) | ✅ 已实现 | `src/services/agent-stream-sdk.ts` (633 行) — 后台执行引擎，`toBaseMessages()` + `toUIMessageStream()`，chunk 缓冲，断线重连，artifact 注入，手动停止 |
| Raw 流式对话 | ✅ 已实现 | `src/services/agent-stream-raw.ts` (520 行) — 原始 LangChain 事件流，3 级恢复机制 |
| 流任务注册表 | ✅ 已实现 | `src/services/stream-registry.ts` — 内存注册表，TTL 清理，pub/sub |
| 路由层 | ✅ 已实现 | `src/routes/chat.ts` (513 行) — 9 个端点：消息历史、同步对话、SDK 流式(POST/GET/stop)、Raw 流式、流状态查询 |
| 消息/会话/员工 CRUD | ✅ 已实现 | `message-service.ts`, `session-service.ts`, `employee-service.ts` |
| 技能管理 | ✅ 已实现 | `skill-service.ts` — 符号链接(junction)、zip 解压、元数据解析 |
| 文件产物追踪 | ✅ 已实现 | `artifact-service.ts` — 文件扫描、MIME 检测、CRUD |
| 定时任务 | ✅ 已实现 | `cron/` — CronScheduler，setTimeout 调度 |
| 数据库 | ✅ 已实现 | SQLite + Drizzle ORM，7 张表（含 `streamTasks`） |
| **checkpointer** | ❌ 未实现 | 无 `MemorySaver` 或任何 checkpointer |
| **interruptOn** | ❌ 未实现 | `createDeepAgent` 未配置 `interruptOn` |
| **question 工具** | ❌ 未实现 | 无自定义 `question` 工具定义 |
| **interrupt-service** | ❌ 未实现 | 文件不存在 |
| **resume 逻辑** | ❌ 未实现 | `agent-stream-sdk.ts` 只处理 fresh 流，不检测/处理 resume |

### 1.2 前端 `apps/web/` 已完成功能

| 模块 | 状态 | 说明 |
|---|---|---|
| 聊天视图（草稿/已有会话） | ✅ 已实现 | `chat-draft-view.tsx`, `chat-conversation-view.tsx` — 均使用 `DefaultChatTransport` |
| 消息渲染 | ✅ 已实现 | `chat-panel.tsx` — `getRenderBlocksFromUIMessage()` 渲染 text/tool/artifact blocks |
| 工具展示（被动） | ✅ 已实现 | `<Tool>/<ToolHeader>/<ToolInput>/<ToolOutput>` — 只读展示，无交互 |
| Artifact 提取 + 预览 | ✅ 已实现 | `artifact-utils.ts`, `ArtifactPreview`, `artifact-panel` + 多格式渲染器 |
| 流式文本 + artifact 注入 | ✅ 已实现 | `onData` 回调处理 `data-artifact` parts |
| 断线重连 | ✅ 已实现 | `ConversationChatView` 配置 `resume: true` + `prepareReconnectToStreamRequest` |
| Slash commands / Mention | ✅ 已实现 | 从员工技能动态生成 |
| **发送完整 messages** | ⚠️ 部分实现 | `DefaultChatTransport.prepareSendMessagesRequest` 已发送 `{ messages, skill }`，但 transport 层是 `DefaultChatTransport` 而非自定义 `ChatTransport` |
| **addToolOutput** | ❌ 未使用 | 代码中无任何调用 |
| **addToolApprovalResponse** | ❌ 未使用 | 代码中无任何调用 |
| **sendAutomaticallyWhen** | ❌ 未配置 | 无任何 `useChat` 配置此项 |
| **工具交互 UI** | ❌ 未实现 | 无 `QuestionToolPart`、`ToolApprovalPart` 等组件 |

### 1.3 关键架构发现

1. **`POST /chat/stream` 已接收 `UIMessage[]`**：后端 `routes/chat.ts:148` 已经解析 `{ messages: UIMessage[]; skill?: string }`，无需兼容旧格式。
2. **前端已发送完整 `messages`**：`chat-draft-view.tsx:74` 和 `chat-conversation-view.tsx:49` 的 `prepareSendMessagesRequest` 已发送 `{ messages, skill }`。
3. **`agent-stream-sdk.ts` 已使用 `toBaseMessages()`**：第 269 行已导入并调用，用于将 `UIMessage[]` 转为 LangChain 格式。
4. **`langchain-stream-parser.ts` 存在但未使用**：这是一个完整的 LangChain SSE 解析器（587 行），支持 tool-input/tool-output 解析，但**从未被任何文件导入**。
5. **`LangChainChatTransport` 存在但仅用于 text2sql**：`apps/web/src/api/langchain-chat-transport.ts` 是一个自定义 `ChatTransport` 实现，但当前只用于 `/digital/api/v1/text2sql/stream` 端点，且只做文本提取。
6. **工具渲染是纯展示**：`chat-panel.tsx:304-331` 对所有 tool parts 统一渲染为可折叠的 `<Tool>` 组件，不区分 `state`（`approval-requested`、`input-available`、`output-available` 等均无差异化 UI）。

---

## 二、核心原理

AI SDK 原生支持"客户端工具"（无 `execute` 的工具）——模型调用工具 → 流推到前端 → 用户交互 → `addToolOutput` 回传 → 自动继续。

但 simple-agents 用的是 DeepAgents（LangGraph 内部循环），工具执行由 LangGraph 管理，不是 AI SDK 的 `streamText`。所以需要结合 **DeepAgents `interruptOn`** + **LangGraph checkpointer** 来实现中断/恢复。

### 数据流（中断场景）

```
1. 用户发消息 → POST /chat/stream（已实现：发送 UIMessage[]）
2. Agent 思考后调用 question/write_file 等工具
3. DeepAgents interruptOn 拦截 → interrupt() → 图暂停
4. toUIMessageStream() 输出 tool-input-available + tool-approval-request
5. 前端 useChat 渲染确认/提问 UI（需新增）
6. 用户回答 → addToolOutput() 或 addToolApprovalResponse() → sendAutomaticallyWhen 自动发送
7. 新 POST /chat/stream（messages 中包含工具结果）→ 后端检测到是 resume（需新增）
8. Command({ resume: { decisions } }) → 图恢复 → Agent 继续
9. 循环直到 Agent 不再调用需要确认的工具
```

---

## 三、`@ai-sdk/langchain` adapter 已提供的能力

源码证实以下能力已可用，**不需要自行实现**：

| 能力 | 说明 |
|---|---|
| `toUIMessageStream()` | 将 LangGraph `streamEvents()` 事件转为 `UIMessageChunk`，已处理 `__interrupt__` 事件 |
| `toBaseMessages()` | 将 AI SDK `UIMessage[]`（含工具结果）转回 LangChain 格式，用于 resume |
| interrupt 事件输出 | 自动输出 `tool-input-start`、`tool-input-available`、`tool-approval-request` chunk |

这意味着前端 `useChat` 可以直接渲染审批 UI（`part.state === "approval-requested"`），用 `addToolApprovalResponse({ id, approved })` 回传。

---

## 四、改动清单

### 4.1 后端 `apps/simple-agents/`（需改动 4 个文件 + 新建 1 个）

| # | 文件 | 当前状态 | 需要改动 |
|---|---|---|---|
| 1 | `src/agent.ts` | 无 checkpointer、无 interruptOn、无 question 工具 | 添加 `checkpointer` + `interruptOn` + `questionTool` |
| 2 | `src/services/agent-stream-sdk.ts` | 已实现 fresh 流，使用 `toBaseMessages()` | 添加 resume 检测 + `Command({ resume })` 恢复逻辑 |
| 3 | `src/services/interrupt-service.ts` | **文件不存在** | **新建** — resume 检测 + decisions 构建 |
| 4 | `src/routes/chat.ts` | 已接收 `{ messages: UIMessage[] }` | 无需改动请求格式；可能需要处理 resume 标识 |
| 5 | `src/types.ts` | 无 Decision/Approval 类型 | 添加 `Decision`、`ApprovalResponse` 类型 |

#### 4.1.1 `src/agent.ts` 改动

```ts
import { MemorySaver } from "@langchain/langgraph"
import { tool } from "@langchain/core/tools"
import { z } from "zod"

// 共享 checkpointer（所有 agent 共享，通过 thread_id 隔离）
const checkpointer = new MemorySaver()

// question 工具定义
const questionTool = tool(
  ({ question, answer }: { question: string; answer: string }) => answer,
  {
    name: "question",
    description: "向用户提问并等待回答。当你缺少必要信息时使用此工具。",
    schema: z.object({
      question: z.string().describe("要问用户的问题"),
      answer: z.string().describe("用户的回答"),
    }),
  }
)

// createDeepAgent 新增参数
const agent = createDeepAgent({
  model,
  systemPrompt: prompt,
  skills: ["/skills/", "/employee-skills/"],
  backend: (runtime: any) => { ... },
  checkpointer,                    // 新增
  interruptOn: {                   // 新增
    question: { allowedDecisions: ["edit", "reject"] },
    write_file: { allowedDecisions: ["approve", "edit", "reject"] },
    edit_file: { allowedDecisions: ["approve", "edit", "reject"] },
    execute: { allowedDecisions: ["approve", "reject"] },
  },
  tools: [questionTool],           // 新增
})
```

**缓存策略不变**：checkpointer 按 `thread_id`（sessionId）隔离，同一 agent 实例可服务多会话。

#### 4.1.2 `src/services/interrupt-service.ts`（新建）

职责：

```ts
// 检测是否为 resume 场景（最后一条 assistant 消息有 approval-requested 状态的 tool part）
function detectResume(messages: UIMessage[]): boolean

// 从 messages 中构建 LangGraph decisions
function buildResumeDecisions(messages: UIMessage[]): Decision[]

// 提取审批响应
function extractApprovalResponses(messages: UIMessage[]): ApprovalResponse[]

// 合并原始参数与用户回答（用于 question 工具的 edit decision）
function mergeArgsWithAnswer(originalArgs: object, answer: string): object
```

Decision 类型：

```ts
type Decision =
  | { type: "approve" }
  | { type: "reject" }
  | { type: "edit"; args: Record<string, unknown> }
```

#### 4.1.3 `src/services/agent-stream-sdk.ts` 改动

在 `runInBackground()` 中添加 resume 分支：

```ts
// 新增：检测 resume
const isResume = detectResume(messages)

if (isResume) {
  // resume 流程
  const decisions = buildResumeDecisions(messages)
  const command = new Command({ resume: { decisions } })
  const config = { configurable: { thread_id: sessionId } }
  const graphStream = await agent.streamEvents(command, {
    ...config,
    streamMode: ["messages"],
  })
  // 后续消费 uiStream 逻辑与 fresh 流程相同
} else {
  // fresh 流程（现有逻辑不变）
  const langchainMessages = await toBaseMessages(messages)
  const graphStream = await agent.stream(
    { messages: langchainMessages },
    { ...config, streamMode: ["messages"] }
  )
}
```

> **注意**：resume 时使用 `agent.streamEvents(command, config)` 而非 `agent.stream()`，因为 `Command({ resume })` 需要通过 `streamEvents` 传递给 LangGraph。

#### 4.1.4 `src/routes/chat.ts` 改动

当前已接收 `{ messages: UIMessage[]; skill?: string }`，无需改动请求格式。

但需要在 `startSdkStream` 调用前或内部判断是否为 resume 场景，以决定走 fresh 还是 resume 分支。

### 4.2 前端 `apps/web/`（需改动 3 个文件 + 新建若干组件）

| # | 文件 | 当前状态 | 需要改动 |
|---|---|---|---|
| 1 | `chat-draft-view.tsx` | 使用 `DefaultChatTransport`，无 `sendAutomaticallyWhen` | 添加 `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` |
| 2 | `chat-conversation-view.tsx` | 使用 `DefaultChatTransport`，无 `sendAutomaticallyWhen` | 同上 |
| 3 | `chat-panel.tsx` | 工具渲染为纯展示，不区分 state | 添加交互式工具 UI（question 输入框、审批按钮） |

#### 4.2.1 useChat 配置改动

在两个 view 组件的 `useChat` 中添加：

```ts
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai"

const { messages, sendMessage, status, error, stop, addToolOutput, addToolApprovalResponse } = useChat({
  // ... 现有配置
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
})
```

`lastAssistantMessageIsCompleteWithToolCalls` 会检测最后一条 assistant 消息的所有工具调用是否都有了对应的 output/approval response，如果是则自动发送。

#### 4.2.2 工具 UI 渲染改动

在 `chat-panel.tsx` 的工具渲染逻辑中，根据 `part.state` 差异化渲染：

| part type | state | UI |
|---|---|---|
| `dynamic-tool` | `approval-requested` | 根据 `toolName` 渲染不同交互 UI |
| `toolName === "question"` | `approval-requested` | 显示问题文本 + 输入框 + 提交按钮 → `addToolOutput()` |
| `toolName === "write_file"` 等 | `approval-requested` | 显示工具名/参数 + 批准/拒绝/编辑按钮 → `addToolApprovalResponse()` |
| `dynamic-tool` | `input-available` | 工具执行中（当前已有） |
| `dynamic-tool` | `output-available` | 工具执行结果（当前已有） |

用户交互处理：

```tsx
// Question 工具 — 用户输入回答后
<button onClick={() => addToolOutput({
  toolCallId: part.toolCallId,
  output: userAnswer,
})}>提交</button>

// 审批工具 — 批准
<button onClick={() => addToolApprovalResponse({
  id: part.approval.id,
  approved: true,
})}>批准</button>

// 审批工具 — 拒绝
<button onClick={() => addToolApprovalResponse({
  id: part.approval.id,
  approved: false,
})}>拒绝</button>
```

> **注意**：`addToolOutput` 和 `addToolApprovalResponse` 需要从 `useChat` 返回值中解构。当前代码中未使用这两个 API。

---

## 五、数据流详解

### 场景 1：工具确认（write_file）

```
1. Agent 调用 write_file({ path: "/foo.txt", content: "hello" })
2. interruptOn 拦截 → graph 暂停
3. toUIMessageStream 输出:
   → tool-input-start (toolCallId, toolName: "write_file", dynamic: true)
   → tool-input-available (input: { path, content })
   → tool-approval-request (approvalId, toolCallId)
   → finish (流正常结束)
4. onFinish 触发 → persistAssistantMessage（parts 包含 approval-request 状态）
5. 前端 useChat 渲染 → part.state === "approval-requested"
6. 用户点击「批准」→ addToolApprovalResponse({ id, approved: true })
7. sendAutomaticallyWhen 检测到所有工具都有响应 → 自动发送
8. 后端收到 messages → detectResume = true
9. buildResumeDecisions → [{ type: "approve" }]
10. Command({ resume: { decisions } }) → agent.streamEvents → 工具执行 → 继续
```

### 场景 2：Question 提问

```
1. Agent 调用 question({ question: "你的项目用的是什么框架？", answer: "" })
2. interruptOn 拦截 → graph 暂停
3. toUIMessageStream 输出:
   → tool-input-start → tool-input-available → tool-approval-request → finish
4. 前端渲染问题 UI → 输入框 → 用户输入 "React"
5. 前端调用 addToolOutput({ toolCallId, output: "React" })
   （注意：question 工具用 addToolOutput 传 answer，审批工具用 addToolApprovalResponse）
6. sendAutomaticallyWhen 触发 → POST /chat/stream
7. 后端收到 messages → detectResume = true
8. buildResumeDecisions → [{ type: "edit", args: { question: "...", answer: "React" } }]
9. Command({ resume }) → question 工具执行 → 返回 "React" → Agent 继续
```

### 场景 3：普通对话（无中断）

与现在完全一致，无任何变化。

---

## 六、关键技术细节

### 6.1 Checkpointer 选择

| 方案 | 特点 | 适用场景 |
|---|---|---|
| `MemorySaver` | 简单，内存中，重启丢失 | 开发阶段 |
| `@langchain/langgraph-checkpoint-sqlite` | 持久化到 SQLite，重启可恢复 | 生产环境 |

当前项目已有 SQLite（better-sqlite3 + Drizzle），但 checkpointer 是独立的。生产环境建议引入 `@langchain/langgraph-checkpoint-sqlite`。

### 6.2 Agent 缓存策略

当前按 `employeeId` 缓存 agent 实例。checkpointer 绑定在编译后的 graph 上，通过 `thread_id`（即 `sessionId`）隔离不同会话的状态。**缓存策略可以保持不变**。

### 6.3 `question` 工具定义

```ts
const questionTool = tool(
  ({ question, answer }: { question: string; answer: string }) => answer,
  {
    name: "question",
    description: "向用户提问并等待回答。当你缺少必要信息时使用此工具。",
    schema: z.object({
      question: z.string().describe("要问用户的问题"),
      answer: z.string().describe("用户的回答"),
    }),
  }
)
```

### 6.4 Resume 检测逻辑

```ts
function isResumeRequest(messages: UIMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find(m => m.role === "assistant")
  if (!lastAssistant) return false
  return lastAssistant.parts.some(
    part => part.type.startsWith("tool-") && part.state === "output-available"
  )
}
```

更精确的检测应同时检查 `state === "approval-responded"` 和 `state === "output-available"`。

---

## 七、风险与注意事项

| 风险 | 影响 | 缓解 |
|---|---|---|
| `toUIMessageStream()` 对 interrupt 事件的转换是否正确 | 中断时流可能异常结束 | 需要实际测试；interrupt 后 streamEvents 正常结束（无错误） |
| `toBaseMessages()` 能否正确转换 AI SDK 工具结果 | Resume 可能失败 | AI SDK 文档推荐使用此函数；可能需要手动处理 `ToolMessage` |
| Agent 缓存与 checkpointer 共享 | 多会话间状态可能泄漏 | checkpointer 按 thread_id 隔离，理论安全；需测试 |
| 并发 interrupt 恢复 | 同一会话重复 resume 可能冲突 | stream-registry 已有会话级互斥；后端仍需幂等处理 |
| MemorySaver 内存限制 | 服务重启后丢失所有中断状态 | 生产环境换 `@langchain/langgraph-checkpoint-sqlite` |
| addToolOutput vs addToolApprovalResponse | question 用 addToolOutput（传 answer），审批用 addToolApprovalResponse（只传 approved） | 后端 buildResumeDecisions 需区分两种 tool result 来源 |
| Dynamic tool type | DeepAgents 的工具名不在 AI SDK 类型系统中 | 所有工具 part 都是 `dynamic-tool` 类型，通过 `toolName` 区分 |
| onFinish 在中断时触发 | 中断流正常结束也会触发 onFinish | persistAssistantMessage 保存部分内容（包含 approval-request 状态） |
| `agent-stream-sdk.ts` 当前使用 `agent.stream()` 而非 `streamEvents()` | resume 必须用 `streamEvents()` + `Command` | 需要确认 fresh 流程是否也需要切换到 `streamEvents()`，或保持 `stream()` 仅在 resume 时用 `streamEvents()` |

---

## 八、分阶段实施建议

### Phase 1（先跑通 MVP）

- 后端 `agent.ts` — 添加 `MemorySaver` + `interruptOn` + `question` 工具
- 后端 `interrupt-service.ts` — 新建，实现 `detectResume` + `buildResumeDecisions`
- 后端 `agent-stream-sdk.ts` — 添加 resume 分支（`Command({ resume })` + `streamEvents`）
- 前端 `chat-draft-view.tsx` / `chat-conversation-view.tsx` — 添加 `sendAutomaticallyWhen`
- 前端 `chat-panel.tsx` — 添加 question 工具交互 UI（输入框 + 提交）
- 测试：纯 question 工具中断/恢复流程

### Phase 2（生产化）

- 换 `@langchain/langgraph-checkpoint-sqlite` 替代 `MemorySaver`
- 添加工具确认（write_file/edit_file/execute）
- 前端添加审批 UI（批准/拒绝/编辑按钮）
- 完善 resume 检测逻辑（同时检查 `output-available` 和 `approval-responded`）

### Phase 3（UI 完善）

- 独立的 `QuestionToolPart` 组件
- 独立的 `ToolApprovalPart` 组件
- 工具执行状态展示优化
- 错误处理和重试机制

---

## 九、实施顺序（详细）

1. **后端 `agent.ts`** — checkpointer + interruptOn + question 工具
2. **后端 `interrupt-service.ts`** — resume 检测 + decisions 构建（新建文件）
3. **后端 `agent-stream-sdk.ts`** — 接收 UIMessage[]（已实现）+ resume 逻辑 + `Command({ resume })`
4. **后端 `routes/chat.ts`** — 确认请求格式兼容（已实现，无需改动）
5. **前端 `chat-draft-view.tsx`** — 添加 `sendAutomaticallyWhen` + 解构 `addToolOutput`/`addToolApprovalResponse`
6. **前端 `chat-conversation-view.tsx`** — 同上
7. **前端 `chat-panel.tsx`** — 工具 UI 按 state 差异化渲染
8. **集成测试** — question 工具 + write_file 确认完整流程
