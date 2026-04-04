## Questions 工具 + 工具确认 集成方案

### 核心原理

AI SDK 原生支持"客户端工具"（无 `execute` 的工具）——模型调用工具 → 流推到前端 → 用户交互 → `addToolOutput` 回传 → 自动继续。

但 simple-agents 用的是 DeepAgents（LangGraph 内部循环），工具执行由 LangGraph 管理，不是 AI SDK 的 `streamText`。所以需要结合 **DeepAgents `interruptOn`** + **LangGraph checkpointer** 来实现中断/恢复。

### 数据流（中断场景）

```
1. 用户发消息 → POST /chat/stream
2. Agent 思考后调用 question/delete_file 等工具
3. DeepAgents middleware 拦截 → interrupt() → 图暂停
4. toUIMessageStream() 输出 tool-input-available（无 tool output）
5. 前端 useChat 渲染确认/提问 UI
6. 用户回答 → addToolOutput() → sendAutomaticallyWhen 自动发送
7. 新 POST /chat/stream（包含工具结果）→ 后端检测到是 resume
8. Command({ resume: { decisions } }) → 图恢复 → Agent 继续
9. 循环直到 Agent 不再调用需要确认的工具
```

### 改动文件清单

#### 后端 `apps/simple-agents/`（5 个文件）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `package.json` | 添加 `@langchain/langgraph-checkpoint-sqlite`（SQLite 持久化 checkpointer） |
| 2 | `src/agent.ts` | 添加 `checkpointer` + `interruptOn` + 自定义 `question` 工具；改为按 session（thread_id）而非 employeeId 缓存 agent（因为 checkpointer 绑定 agent 实例） |
| 3 | `src/services/agent-service.ts` | `chatStreamResponse()` 改为接收完整 `UIMessage[]`；检测 resume 场景（最后一条 assistant 消息有未完成的工具调用）；resume 时用 `Command({ resume })` + `streamEvents`；用 `toBaseMessages()` 转换消息 |
| 4 | `src/services/interrupt-service.ts` | **新建** — 管理 interrupt 状态（检测 `__interrupt__`、提取 `actionRequests`、将 AI SDK tool results 转为 LangGraph `decisions`） |
| 5 | `src/routes/chat.ts` | `POST /chat/stream` 请求体从 `{ message }` 改为 `{ messages: UIMessage[] }`（兼容旧格式） |

#### 前端 `apps/web/`（2 个文件）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/lib/chat/langchain-chat-transport.ts` | `sendMessages` 发送完整 `messages` 数组而非只发文本；请求体格式改为 `{ messages }` |
| 2 | `src/components/chat/chat-view.tsx`（或 useChat 配置处） | 添加 `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`；添加 `onToolCall` 处理确认逻辑 |

#### 前端 UI 组件（3 个新文件，可选）

| # | 文件 | 用途 |
|---|---|---|
| 1 | `QuestionToolPart` | 渲染 `tool-question`：显示问题 + 输入框 + 提交按钮 |
| 2 | `ToolApprovalPart` | 渲染工具确认：显示工具名/参数 + 批准/拒绝/编辑按钮 |
| 3 | 或在现有 `MessagePartRenderer` 中添加 case |

### 关键技术细节

#### 1. Checkpointer 选择

- **`MemorySaver`**：简单，内存中，重启丢失。适合开发阶段
- **`@langchain/langgraph-checkpoint-sqlite`**：持久化到 SQLite，重启后可恢复。生产推荐

#### 2. Agent 缓存策略调整

当前按 `employeeId` 缓存 agent 实例。但 `checkpointer` 绑定在编译后的 graph 上，同一个 agent 实例的 checkpointer 可以通过 `thread_id`（即 `sessionId`）隔离不同会话的状态。所以 **缓存策略可以不变**，checkpointer 内部按 thread_id 隔离。

#### 3. `question` 工具定义

```typescript
const questionTool = tool(
  ({ question, answer }: { question: string; answer: string }) => {
    return answer  // 返回用户的回答
  },
  {
    name: "question",
    description: "向用户提问并等待回答。当你需要更多信息才能继续时使用。",
    schema: z.object({
      question: z.string().describe("要问用户的问题"),
    }),
  }
)
```

配置 `interruptOn: { question: true, write_file: true, edit_file: true, execute: true }`

当 agent 调用 `question` 时：

1. Interrupt 拦截 → 暂停
2. 前端显示 `tool-input-available` 状态
3. 用户回答 → `addToolOutput({ tool: 'question', output: "React" })`
4. 后端构建 decision: `{ type: "edit", args: { question: "原问题", answer: "React" } }`
5. Resume → 工具执行返回 "React" → Agent 继续思考

#### 4. Resume 检测逻辑

```typescript
function isResumeRequest(messages: UIMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find(m => m.role === "assistant")
  if (!lastAssistant) return false
  return lastAssistant.parts.some(
    part => part.type.startsWith("tool-") && part.state === "output-available"
  )
}
```

#### 5. Request Body 兼容

后端同时支持两种格式：

- **旧格式** `{ message: "text" }` → 简单聊天，无中断
- **新格式** `{ messages: UIMessage[] }` → 支持完整工具调用/结果链，支持 resume

### 风险与注意事项

| 风险 | 影响 | 缓解 |
|---|---|---|
| `toUIMessageStream()` 对 interrupt 事件的转换是否正确 | 中断时流可能异常结束 | 需要实际测试；interrupt 后 streamEvents 正常结束（无错误） |
| `toBaseMessages()` 能否正确转换 AI SDK 工具结果 | Resume 可能失败 | AI SDK 文档推荐使用此函数；可能需要手动处理 `ToolMessage` |
| Agent 缓存与 checkpointer 共享 | 多会话间状态可能泄漏 | checkpointer 按 thread_id 隔离，理论安全；需测试 |
| 并发 interrupt 恢复 | 同一会话重复 resume 可能出错 | AI SDK 的 `sendAutomaticallyWhen` 保证串行；后端仍需幂等处理 |

### 分阶段实施建议

**Phase 1（先跑通）**：只用 `MemorySaver` + `question` 工具 + AI SDK 流，不改 raw-stream

**Phase 2（生产化）**：换 `@langchain/langgraph-checkpoint-sqlite`，添加工具确认（write_file/edit_file）

**Phase 3（UI 完善）**：确认/提问 UI 组件、工具执行状态展示

---

## 流式返回的是 `UIMessageChunk` 类型

`toUIMessageStream()` 将 LangChain `streamEvents()` 的各种事件（`on_chat_model_stream`, `on_tool_start`, `on_tool_end` 等）逐一转换为 `UIMessageChunk`，通过 `ReadableStream<UIMessageChunk>` 输出。每个 `enqueue()` 的值都是标准 `UIMessageChunk`。

## 并且 `@ai-sdk/langchain` 已经原生支持 interrupt

源码证实：`toUIMessageStream()` 内部已经处理了 LangGraph 的 `__interrupt__` 事件，当 DeepAgents 触发 `interrupt()` 时，adapter 会自动输出：

```
tool-input-start    → { type: "tool-input-start", toolCallId, toolName, dynamic: true }
tool-input-available → { type: "tool-input-available", toolCallId, toolName, input, dynamic: true }
tool-approval-request → { type: "tool-approval-request", approvalId, toolCallId }
```

这意味着**前端 AI SDK `useChat` 可以直接渲染审批 UI**（`part.state === "approval-requested"`），然后用 `addToolApprovalResponse({ id, approved })` 回传。

`toBaseMessages()` 也已导出，可以正确将 AI SDK `UIMessage`（包含工具结果）转换回 LangChain 格式，用于 resume。

## 结论

集成 questions 工具 + 工具确认，**`@ai-sdk/langchain` adapter 这层已经帮你做了大部分工作**。实际需要改的主要是：

1. **后端 agent.ts** — 加 `checkpointer` + `interruptOn` + `question` 工具
2. **后端 agent-service.ts** — 支持 resume（检测有未完成工具调用的消息 → 用 `Command({ resume })` 恢复）+ 用 `toBaseMessages()` 转换消息
3. **前端 transport** — 发完整 `messages` 数组（包含工具结果）
4. **前端 useChat 配置** — `sendAutomaticallyWhen` + 审批/提问 UI

数据流已经是 AI SDK 标准协议，不需要自定义事件类型。

----------------

以下是完整集成计划：

---

## 完整集成计划：Questions 工具 + 工具确认

### 架构概览

```
┌──────────────┐     POST /chat/stream      ┌──────────────────┐
│   前端       │ ◄────────────────────────── │   simple-agents   │
│   useChat    │     AI SDK SSE 协议         │   后端            │
│              │                            │                  │
│ tool-approval-│  UIMessageChunk            │ agent.ts        │
│ requested    │  ────────────────►          │ ├─ checkpointer  │
│              │                            │ ├─ interruptOn   │
│ 用户交互      │                            │ └─ question tool │
│              │                            │                  │
│ addToolOutput │  messages (含工具结果)       │ agent-service.ts │
│ 或 Approval  │ ────────────────►          │ ├─ 检测 resume   │
│ Response     │                            │ ├─ Command resume│
│              │                            │ └─ toBaseMessages │
└──────────────┘                            └──────────────────┘
```

### 核心流程

```
正常流程（无中断）:
  用户发消息 → messages → toBaseMessages → agent.streamEvents → toUIMessageStream → SSE

中断流程（工具确认/提问）:
  用户发消息 → agent 调用工具 → interrupt() → graph 暂停
  → toUIMessageStream 输出 tool-approval-request → 流结束
  → 前端渲染确认/提问 UI
  → 用户响应 → addToolOutput/addToolApprovalResponse
  → sendAutomaticallyWhen 触发 → POST /chat/stream (含工具结果)
  → 后端检测 resume → Command({ resume: decisions }) → agent.streamEvents → 继续
```

---

### 改动清单

#### 后端 `apps/simple-agents/`（5 个文件）

**1. `package.json`** — 无新依赖

`MemorySaver` 已在 `@langchain/langgraph` 中导出，`Command` 同理。不需要额外安装。

**2. `src/agent.ts`** — 添加 checkpointer + interruptOn + question 工具

改动点：

- 从 `@langchain/langgraph` 导入 `MemorySaver`
- 创建共享 `checkpointer` 实例（所有 agent 共享，通过 thread_id 隔离）
- `createDeepAgent` 新增参数：

  ```ts
  checkpointer,
  interruptOn: {
    question: { allowedDecisions: ["edit", "reject"] },
    write_file: { allowedDecisions: ["approve", "edit", "reject"] },
    edit_file: { allowedDecisions: ["approve", "edit", "reject"] },
    execute: { allowedDecisions: ["approve", "reject"] },
  },
  tools: [questionTool],
  ```

- 新增 `questionTool` 定义：

  ```ts
  tool(
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

- **缓存策略不变**：checkpointer 按 thread_id（sessionId）隔离，同一 agent 实例可服务多会话

**3. `src/services/agent-service.ts`** — 支持 resume + 接收完整 UIMessage[]

改动点：

- 从 `@ai-sdk/langchain` 导入 `toBaseMessages`
- 从 `@langchain/langgraph` 导入 `Command`
- `chatStreamResponse` 签名变更：

  ```ts
  // 之前
  chatStreamResponse(sessionId, userMessage: string, employeeId?)
  // 之后
  chatStreamResponse(sessionId, messages: UIMessage[], employeeId?)
  ```

- 新增 `detectResume(messages)` 函数：
  - 检查最后一条 assistant 消息是否有 `state === "approval-requested"` 或 `state === "approval-responded"` 的 tool part
  - 如果有 → 这是 resume 场景
- 新增 `buildResumeDecisions(messages)` 函数：
  - 找到 `approval-responded` parts → 提取 approval 信息
  - 对 question 工具：`{ type: "edit", args: { question: 原问题, answer: 用户答案 } }`
  - 对 approve 工具：`{ type: "approve" }`
  - 对 reject 工具：`{ type: "reject" }`
- resume 流程：

  ```ts
  const command = new Command({ resume: { decisions } })
  const eventStream = agent.streamEvents(command, config)
  ```

- fresh 流程（兼容旧逻辑）：

  ```ts
  const langchainMessages = await toBaseMessages(messages)
  const eventStream = agent.streamEvents({ messages: langchainMessages }, config)
  ```

- `onFinish` 保持不变（persistAssistantMessage）

**4. `src/routes/chat.ts`** — 兼容两种请求格式

`POST /chat/stream` 请求体兼容：

```ts
// 旧格式（纯文本）
{ message: "你好" }

// 新格式（完整 UIMessage 数组，含工具结果）
{ messages: UIMessage[] }
```

后端处理逻辑：

```ts
let uiMessages: UIMessage[]
if (body.messages && Array.isArray(body.messages)) {
  uiMessages = body.messages
} else if (body.message) {
  // 兼容旧格式：构造简单的 user message
  uiMessages = [{ id: generateId(), role: "user", parts: [{ type: "text", text: body.message }] }]
} else {
  return c.json({ error: "message or messages required" }, 400)
}
```

**5. `src/services/interrupt-service.ts`** — **新建**，interrupt/resume 逻辑提取

职责：

- `detectResume(messages: UIMessage[]): boolean`
- `buildResumeDecisions(messages: UIMessage[]): Decision[]`
- `extractApprovalResponses(messages: UIMessage[]): ApprovalResponse[]`
- `mergeArgsWithAnswer(originalArgs: object, answer: string): object`

---

#### 前端 `apps/web/`（3 个文件）

**1. `src/lib/chat/langchain-chat-transport.ts`** — 发送完整 messages

改动点：

- `sendMessages` 改为发送完整 `messages` 数组：

  ```ts
  body: JSON.stringify({ messages }),
  ```

- 不再只提取最新一条消息的文本

**2. `src/lib/chat/use-chat-config.ts`** — **新建**，useChat 统一配置

```ts
import { useChat } from "@ai-sdk/react"
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai"
import { chatTransport } from "@/components/chat/chat-view-shared"

export function useSimpleAgentsChat(options: {
  sessionId: string
  initialMessages?: UIMessage[]
}) {
  return useChat({
    id: options.sessionId,
    transport: chatTransport,
    messages: options.initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })
}
```

**3. `src/components/chat/`** — 工具 UI 渲染

在消息渲染处添加对以下 part 状态的处理：

| part type | state | UI |
|---|---|---|
| `dynamic-tool` | `approval-requested` | 根据 `toolName` 渲染不同 UI |
| `toolName === "question"` | `approval-requested` | 显示问题文本 + 输入框 + 提交按钮 |
| `toolName === "write_file"` 等 | `approval-requested` | 显示工具名/参数 + 批准/拒绝按钮 |
| `dynamic-tool` | `input-available` | 工具执行中... |
| `dynamic-tool` | `output-available` | 工具执行结果 |

用户交互处理：

```tsx
// Question 工具
<button onClick={() => addToolOutput({
  toolCallId: part.toolCallId,
  output: userAnswer, // 用户输入的回答
})}>提交</button>

// 审批工具（批准）
<button onClick={() => addToolApprovalResponse({
  id: part.approval.id,
  approved: true,
})}>批准</button>

// 审批工具（拒绝）
<button onClick={() => addToolApprovalResponse({
  id: part.approval.id,
  approved: false,
})}>拒绝</button>
```

---

### 数据流详解

#### 场景 1：工具确认（write_file）

```
1. Agent 调用 write_file({ path: "/foo.txt", content: "hello" })
2. interruptOn 拦截 → graph 暂停
3. toUIMessageStream 输出:
   → { type: "tool-input-start", toolCallId: "hitl-write_file-xxx", toolName: "write_file", dynamic: true }
   → { type: "tool-input-available", toolCallId, toolName: "write_file", input: { path: "/foo.txt", content: "hello" }, dynamic: true }
   → { type: "tool-approval-request", approvalId: "hitl-write_file-xxx", toolCallId: "hitl-write_file-xxx" }
   → { type: "finish", finishReason: "stop" }  // 流正常结束
4. onFinish 触发 → persistAssistantMessage（parts 包含 approval-request 状态）
5. 前端 useChat 渲染 → part.state === "approval-requested"
6. 用户点击「批准」→ addToolApprovalResponse({ id: "hitl-write_file-xxx", approved: true })
7. sendAutomaticallyWhen 检测到所有工具都有响应 → 自动发送
8. 后端收到 messages → detectResume = true
9. buildResumeDecisions → [{ type: "approve" }]
10. Command({ resume: { decisions } }) → agent.streamEvents → 工具执行 → 继续
```

#### 场景 2：Question 提问

```
1. Agent 调用 question({ question: "你的项目用的是什么框架？", answer: "" })
2. interruptOn 拦截 → graph 暂停
3. toUIMessageStream 输出:
   → { type: "tool-input-start", toolCallId: "hitl-question-xxx", toolName: "question", dynamic: true }
   → { type: "tool-input-available", toolCallId, toolName: "question", input: { question: "...", answer: "" }, dynamic: true }
   → { type: "tool-approval-request", approvalId: "hitl-question-xxx", toolCallId: "hitl-question-xxx" }
   → { type: "finish", finishReason: "stop" }
4. 前端渲染问题 UI → 输入框 → 用户输入 "React"
5. 前端调用 addToolOutput({ toolCallId: "hitl-question-xxx", output: "React" })
   （注意：用 addToolOutput 而非 addToolApprovalResponse，因为我们要传回 answer）
6. sendAutomaticallyWhen 触发 → POST /chat/stream
7. 后端收到 messages → detectResume = true
8. buildResumeDecisions:
   - 检测到 question 工具有 output → { type: "edit", args: { question: "...", answer: "React" } }
9. Command({ resume: { decisions } }) → question 工具执行 → 返回 "React" → Agent 继续
```

#### 场景 3：普通对话（无中断）

```
与现在完全一致，无任何变化
```

---

### 风险与注意事项

| 项目 | 说明 | 缓解 |
|---|---|---|
| MemorySaver 内存限制 | 服务重启后丢失所有中断状态 | 生产环境换 `@langchain/langgraph-checkpoint-sqlite` |
| 并发 resume | 同一会话多次 resume 可能冲突 | stream-registry 已有会话级互斥 |
| addToolOutput vs addToolApprovalResponse | question 用 addToolOutput（传 answer），审批用 addToolApprovalResponse（只传 approved） | 后端 buildResumeDecisions 需区分两种 tool result 来源 |
| Dynamic tool type | DeepAgents 的工具名不在 AI SDK 类型系统中 | 所有工具 part 都是 `dynamic-tool` 类型，通过 `toolName` 区分 |
| onFinish 在中断时触发 | 中断流正常结束也会触发 onFinish | persistAssistantMessage 保存部分内容（包含 approval-request 状态） |

### 实施顺序

1. 后端 `agent.ts` — checkpointer + interruptOn + question 工具
2. 后端 `interrupt-service.ts` — resume 检测 + decisions 构建
3. 后端 `agent-service.ts` — 接收 UIMessage[] + resume 逻辑
4. 后端 `routes/chat.ts` — 兼容请求格式
5. 前端 `langchain-chat-transport.ts` — 发送完整 messages
6. 前端工具 UI 组件
7. 集成测试
