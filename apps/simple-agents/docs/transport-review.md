# Simple Agents Transport 复盘文档

> 基于 LangGraph `stream()` + AI SDK `useChat` 的 Human-in-the-Loop 实现

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                          Frontend (React)                        │
│                                                                  │
│  chat-panel.tsx ── 渲染 UIMessage，处理审批 UI                    │
│       ↑                                                          │
│  useChat (@ai-sdk/react) ── 管理消息状态、审批状态                 │
│       ↑                                                          │
│  SimpleAgentsTransport ── 自定义 ChatTransport                     │
│       ↑                                                          │
│  SSE (text/event-stream) ── 接收 /raw-stream 或 /raw-stream/resume│
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ POST /chat/raw-stream 或 /chat/raw-stream/resume
                           │ SSE Response
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Hono + LangGraph)                     │
│                                                                  │
│  chat.ts ── SSE 路由，接收请求 → 启动 agent → 广播事件             │
│       ↑                                                          │
│  agent-stream-raw.ts ── stream(streamMode) 迭代 + 事件广播         │
│       ↑                                                          │
│  createDeepAgent ── DeepAgent (checkpointer + interruptOn)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、后端 — agent-stream-raw.ts

### 2.1 核心设计

使用 LangGraph 的 `stream()` 替代 `streamEvents()`，通过 `streamMode: ["messages", "updates"]` 获取结构化事件：

```typescript
const eventStream = await agent.stream(input, {
  configurable: { thread_id: sessionId },
  streamMode: ["messages", "updates"],
  signal: task.abortController.signal,
})
```

**输出格式**：每个 event 是 `[modeName, payload]` 元组：
- `["messages", [AIMessageChunk, metadata]]` — 文本 token、工具调用
- `["updates", { nodeName: stateUpdate }]` — 节点级状态变化
- `["updates", { "__interrupt__": [...] }]` — interrupt 触发

### 2.2 事件处理流程

```
processStreamEvents()
  ├── mode === "messages"
  │   ├── chunk.content → 文本 token → broadcast("messages")
  │   ├── chunk.tool_call_chunks → 工具调用 → broadcast("messages")
  │   └── chunk.tool_calls → 完整工具调用 → broadcast("messages")
  │
  └── mode === "updates"
      ├── data.__interrupt__ → return { interrupted: true, interrupts }
      └── 其他 → broadcast("updates")
```

### 2.3 Interrupt 检测

```typescript
if (data && typeof data === "object" && "__interrupt__" in data) {
  return { fullContent, interrupted: true, interrupts: data.__interrupt__ }
}
```

Interrupt 后必须调用 `completeTask(task.id, null)` 释放注册表 slot，否则 resume 请求会收到 409。

### 2.4 两种运行模式

| 模式 | 入口 | 输入 | 用途 |
|------|------|------|------|
| **Fresh** | `startStream()` | `{ messages: [...] }` | 用户发送新消息 |
| **Resume** | `startStreamWithResume()` | `Command({ resume: { decisions } })` | 审批后恢复执行 |

---

## 三、后端 — chat.ts 路由

### 3.1 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/:id/chat/raw-stream` | POST | 启动流式对话 |
| `/:id/chat/raw-stream/resume` | POST | 审批后恢复 |
| `/:id/stream/:streamId` | GET | 恢复/订阅流 |
| `/:id/stream/:streamId/cancel` | POST | 取消流 |
| `/:id/stream` | GET | 查询流状态 |

### 3.2 SSE 广播

```
请求 → startStream() → 注册订阅者 → SSE 循环 → 广播 StreamEvent
                                                    ↓
                                          interrupt / done / error → 结束 SSE
```

---

## 四、前端 — SimpleAgentsTransport

### 4.1 类结构

```typescript
class SimpleAgentsTransport<UI_MESSAGE extends UIMessage>
  implements ChatTransport<UI_MESSAGE>
{
  sendMessages({ chatId, messages, abortSignal })
  reconnectToStream()
  processResponseStream(stream, isResume)
}
```

### 4.2 sendMessages 决策树

```
sendMessages()
  ↓
extractResumeDecisions(messages)
  ↓
  ├── 有 approval-responded part → POST /raw-stream/resume
  │   body: { resumeDecisions: { toolCallId: { type: "approve", ... } } }
  │
  └── 无 → POST /raw-stream
      body: { message: "用户文本", skill?: "..." }
```

### 4.3 SSE 解析 → UIMessageChunk 映射

| SSE Event | UIMessageChunk | 说明 |
|-----------|---------------|------|
| `messages` + `chunk.content` | `text-delta` | 文本流式输出 |
| `messages` + `tool_call_chunks` (有 id) | `tool-input-start` | 新工具调用开始 |
| `messages` + `tool_call_chunks` (有 args) | `tool-input-delta` | 工具参数流式 |
| `messages` + `tool_call_chunks` (args 可解析) | `tool-input-available` | 工具参数完整 |
| `updates` + `tools.messages` (非 resume) | `tool-output-available` | 工具执行结果 |
| `interrupt` + `actionRequests` | `tool-approval-request` | 需要审批 |
| `done` | `finish` | 流结束 |
| `error` | `error` | 流错误 |
| `cancelled` | `finish` | 流取消 |

### 4.4 tool_call_chunks 处理（关键修复）

**问题**：LangChain 的 `tool_call_chunks` 行为（官方 issue #8394）：
- 第一个 chunk 有 `id` + `name` + `args`（可能为空或完整）
- 后续碎片 chunk 只有 `args`，没有 `id` 和 `name`
- **所有 chunk 的 `index` 都是 0**（不能用 index 区分）

**解决方案**：用 `tc.id` 作为 tracker key，`currentTracker` 追踪当前流式输出：

```typescript
let currentTracker: { value: ToolCallTracker | null }

for (const tc of chunk.tool_call_chunks) {
  if (tc.id) {
    // 新工具调用 → 创建/查找 tracker，切换 currentTracker
    tracker = toolCallTrackers.get(tc.id)
    if (!tracker) { tracker = { id: tc.id, ... }; toolCallTrackers.set(tc.id, tracker) }
    currentTracker.value = tracker
  } else if (currentTracker.value) {
    // 当前工具的后续 args 碎片 → 复用 currentTracker
    tracker = currentTracker.value
  } else {
    continue
  }
  // 发送 tool-input-start / tool-input-delta / tool-input-available
}
```

### 4.5 Interrupt 处理

```
interrupt 事件
  ↓
遍历 actionRequests
  ↓
按 toolName + args 内容匹配已有 tracker
  ├── 匹配成功 → 发送 tool-approval-request（更新已有 part 状态）
  └── 匹配失败 → 创建新 dynamic-tool part + tool-approval-request
```

匹配逻辑：`JSON.stringify(JSON.parse(tracker.argsText)) === JSON.stringify(action.args)`

### 4.6 Resume 流特殊处理

**Resume 流中跳过 `tool-output-available`**：

```typescript
if (data.tools && Array.isArray(data.tools.messages) && !isResume) {
  // 发送 tool-output-available
}
```

**原因**：AI SDK 的 `getToolInvocation()` 只在当前正在构建的消息中查找 tool part。Resume 时创建新消息，旧消息中的 tool part 不在新消息上下文中，发送 `tool-output-available` 会报错。

### 4.7 extractResumeDecisions

```typescript
function extractResumeDecisions(messages: UIMessage[]) {
  // 查找最后一条 assistant message
  // 检查是否有 state === "approval-responded" 的 part
  // 构建: { toolCallId: { type: "approve" | "reject", args } }
}
```

---

## 五、前端 — 审批流程

### 5.1 完整 Resume 运行流程

```
1. Agent 执行到 interruptOn 工具
   ↓
2. 后端检测到 __interrupt__ → 广播 { type: "interrupt", interrupts }
   → SSE 结束
   ↓
3. 前端 transport 解析 interrupt → 发送 tool-approval-request
   → useChat 更新 part state → "approval-requested"
   → ChatPanel 渲染审批按钮
   ↓
4. 用户点击"批准"
   ↓
5. chat-panel.tsx:
   addToolApprovalResponse({ id: toolCallId, approved: true })
   → useChat 更新 part state → "approval-responded"
   → onSendMessage?.() → sendMessage({ text: "" })
   ↓
6. useChat 调用 transport.sendMessages({ messages })
   ↓
7. SimpleAgentsTransport.sendMessages():
   extractResumeDecisions(messages) → 检测到 approval-responded
   → POST /raw-stream/resume { resumeDecisions: { toolCallId: { type: "approve" } } }
   ↓
8. 后端 chat.ts:
   startStreamWithResume(sessionId, resumeDecisions)
   ↓
9. 后端 agent-stream-raw.ts:
   runAgentInBackgroundResume()
   → new Command({ resume: { decisions } })
   → agent.stream(command, { streamMode: ["messages", "updates"] })
   → Agent 从 checkpoint 恢复执行
   ↓
10. Agent 继续执行（可能再次触发 interrupt，或完成）
    ↓
11. 前端 transport 解析 resume 流
    → 跳过 tool-output-available（isResume = true）
    → 正常处理 text-delta 等
    → done → finish
```

### 5.2 多轮审批

```
用户消息 → Agent 执行 → Interrupt (工具 A) → 批准
  → Resume → Agent 继续 → Interrupt (工具 B) → 批准
  → Resume → Agent 继续 → 完成
```

每轮 Interrupt 后：
1. 后端 `completeTask(task.id, null)` 释放 slot
2. 前端 `extractResumeDecisions` 只检测最新的 `approval-responded`
3. 新的 resume 请求创建新的 stream task

### 5.3 消息合并（UI 层）

Resume 后 AI SDK 会创建新的 assistant message。`chat-panel.tsx` 在渲染时合并连续相同 role 的消息：

```typescript
const groupedMessages: UIMessage[][] = []
for (const message of displayMessages) {
  const last = groupedMessages[groupedMessages.length - 1]
  if (last && last[0].role === message.role) {
    last.push(message)
  } else {
    groupedMessages.push([message])
  }
}
```

视觉上：`[user] [assistant(工具 + 结果)] [user] [assistant(工具 + 结果)]`

---

## 六、踩坑记录

### 6.1 tool_call_chunks 的 index 始终为 0

**现象**：多个工具调用共享同一个 index，导致所有工具调用共享同一个 tracker。

**修复**：用 `tc.id` 作为 key，`currentTracker` 追踪当前流式输出。

### 6.2 LangChain ToolMessage 序列化格式

**现象**：`data.tools.messages` 中的消息是 `{lc:1, type:"constructor", kwargs:{...}}` 格式，`kwargs.type` 是 `"ToolMessage"` 不是 `"tool"`。

**修复**：直接检查 `kwargs.tool_call_id` 存在性，不检查 type 字段。

### 6.3 Resume 流中 tool-output-available 报错

**现象**：`No tool invocation found for tool call ID "call_abc"`。

**原因**：AI SDK 在新消息中找不到旧消息的 tool part。

**修复**：Resume 流中跳过 `tool-output-available` 的发送。

### 6.4 Interrupt 后 task 未释放

**现象**：resume 请求返回 409 "Session already has an active stream"。

**原因**：Interrupt 后直接 return，没有调用 `completeTask()` 释放注册表 slot。

**修复**：Interrupt 分支中调用 `completeTask(task.id, null)`。

### 6.5 变量遮蔽导致 undefined

**现象**：`Cannot read properties of undefined (reading 'sentInputStart')`。

**原因**：`let tracker = toolCallTrackers.get(tc.id)` 创建了局部变量，遮蔽了外层 `tracker`。

**修复**：去掉 `let`，直接赋值给外层变量。

---

## 七、文件清单

| 文件 | 说明 |
|------|------|
| `apps/web/src/lib/chat/simple-agents-transport.ts` | 自定义 ChatTransport，SSE → UIMessageChunk 转换 |
| `apps/web/src/components/chat/chat-panel.tsx` | 消息渲染、审批 UI、连续消息合并 |
| `apps/web/src/components/chat/chat-draft-view.tsx` | 草稿视图，useChat + transport 配置 |
| `apps/web/src/components/chat/chat-conversation-view.tsx` | 对话视图，useChat + transport 配置 |
| `apps/simple-agents/src/services/agent-stream-raw.ts` | LangGraph stream() 封装，事件广播 |
| `apps/simple-agents/src/types.ts` | StreamEvent 类型定义 |
| `apps/simple-agents/src/routes/chat.ts` | SSE 路由（raw-stream + resume） |
| `apps/simple-agents/src/agent.ts` | DeepAgent 配置（checkpointer + interruptOn） |
