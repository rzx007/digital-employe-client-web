# 纯手动渲染方案分析

> 不依赖 AI SDK (`useChat`)，完全手动管理消息状态和 SSE 流

---

## 一、方案概述

### 1.1 当前架构 vs 手动渲染

| 维度 | 当前 (useChat + Transport) | 纯手动渲染 |
|------|---------------------------|-----------|
| **消息管理** | AI SDK 自动管理 | 自建 `useState` / `useReducer` |
| **SSE 消费** | Transport → UIMessageChunk → useChat 内部处理 | 直接 fetch + ReadableStream 解析 |
| **工具状态** | AI SDK 自动合并 part state | 手动匹配 toolCallId 更新状态 |
| **审批流程** | addToolApprovalResponse → sendAutomaticallyWhen | 手动构建 resume 请求 |
| **代码量** | ~500 行 (transport + 少量 view 改动) | ~300 行 (完整消息管理 + SSE 解析) |
| **可控性** | 受限于 AI SDK 内部逻辑 | 完全可控 |
| **维护成本** | 依赖 AI SDK 版本兼容性 | 无外部依赖，自行维护 |

### 1.2 适用场景

- AI SDK 的 `useChat` 与自定义 transport 之间存在不可调和的兼容问题
- 需要完全控制消息渲染的每个细节（如自定义动画、特殊布局）
- 希望减少包体积（`ai` 包约 200KB）
- 团队希望完全掌握数据流，不依赖黑盒

---

## 二、核心设计

### 2.1 消息数据结构

```typescript
// 简化版消息结构（不依赖 UIMessage）
interface Message {
  id: string
  role: "user" | "assistant"
  content: string           // 纯文本内容
  toolCalls: ToolCall[]     // 工具调用列表
  createdAt: number
}

interface ToolCall {
  id: string                // toolCallId，如 "call_abc123"
  name: string              // 工具名，如 "read_file"
  input: Record<string, unknown> | null  // 工具参数
  output: string | null     // 工具输出
  state: "calling" | "input-ready" | "approval-requested" | "approved" | "rejected" | "completed" | "error"
  approvalResponse?: { approved: boolean }
}
```

### 2.2 状态管理

```typescript
interface ChatState {
  messages: Message[]
  status: "idle" | "streaming" | "waiting-approval" | "error"
  error: string | null
  currentStreamId: string | null
}

// 使用 useReducer 管理状态
type ChatAction =
  | { type: "ADD_USER_MESSAGE"; message: Message }
  | { type: "START_STREAM" }
  | { type: "APPEND_TEXT"; text: string }
  | { type: "ADD_TOOL_CALL"; toolCall: ToolCall }
  | { type: "UPDATE_TOOL_CALL"; toolCallId: string; updates: Partial<ToolCall> }
  | { type: "SET_APPROVAL"; toolCallId: string; approved: boolean }
  | { type: "FINISH_STREAM" }
  | { type: "SET_ERROR"; error: string }
  | { type: "RESET" }
```

### 2.3 核心 Hook

```typescript
function useManualChat(sessionId: string) {
  const [state, dispatch] = useReducer(chatReducer, initialState)

  // 发送用户消息
  const sendMessage = async (text: string, skill?: string) => {
    const userMsg: Message = { id: nanoid(), role: "user", content: text, createdAt: Date.now() }
    dispatch({ type: "ADD_USER_MESSAGE", message: userMsg })

    const response = await fetch(`/api/sessions/${sessionId}/chat/raw-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, skill }),
    })

    await processStream(response.body)
  }

  // 审批后恢复
  const resumeAfterApproval = async (decisions: Record<string, { type: string }>) => {
    const response = await fetch(`/api/sessions/${sessionId}/chat/raw-stream/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeDecisions: decisions }),
    })

    await processStream(response.body)
  }

  // 处理 SSE 流
  const processStream = async (body: ReadableStream<Uint8Array> | null) => {
    dispatch({ type: "START_STREAM" })
    // ... SSE 解析逻辑
  }

  return {
    messages: state.messages,
    status: state.status,
    error: state.error,
    sendMessage,
    resumeAfterApproval,
    stop: () => { /* abort controller */ },
  }
}
```

---

## 三、SSE 解析器

### 3.1 事件解析

```typescript
async function processStream(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // 按 \n\n 分割 SSE 事件
      let boundaryIndex = buffer.indexOf("\n\n")
      while (boundaryIndex !== -1) {
        const eventText = buffer.slice(0, boundaryIndex)
        buffer = buffer.slice(boundaryIndex + 2)

        parseSSEEvent(eventText)

        boundaryIndex = buffer.indexOf("\n\n")
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function parseSSEEvent(eventText: string) {
  const lines = eventText.split("\n").filter(l => l.startsWith("data:"))
  if (lines.length === 0) return

  const data = lines.map(l => l.slice(5).trim()).join("\n")
  if (data === "[DONE]") {
    dispatch({ type: "FINISH_STREAM" })
    return
  }

  let payload: any
  try { payload = JSON.parse(data) } catch { return }

  switch (payload.type) {
    case "messages":
      handleMessagesEvent(payload)
      break
    case "updates":
      handleUpdatesEvent(payload)
      break
    case "interrupt":
      handleInterruptEvent(payload)
      break
    case "done":
      dispatch({ type: "FINISH_STREAM" })
      break
    case "error":
      dispatch({ type: "SET_ERROR", error: payload.message })
      break
  }
}
```

### 3.2 事件处理

```typescript
// 当前正在构建的 assistant message
let currentAssistantMsg: Message | null = null

function handleMessagesEvent(payload: any) {
  const { chunk } = payload

  // 文本 token
  if (chunk.content) {
    if (!currentAssistantMsg) {
      currentAssistantMsg = {
        id: nanoid(),
        role: "assistant",
        content: "",
        toolCalls: [],
        createdAt: Date.now(),
      }
      dispatch({ type: "ADD_USER_MESSAGE", message: currentAssistantMsg })
    }
    currentAssistantMsg.content += chunk.content
  }

  // 工具调用
  if (chunk.tool_call_chunks?.length > 0) {
    for (const tc of chunk.tool_call_chunks) {
      if (tc.id) {
        // 新工具调用
        const toolCall: ToolCall = {
          id: tc.id,
          name: tc.name || "unknown",
          input: null,
          output: null,
          state: "calling",
        }
        currentAssistantMsg?.toolCalls.push(toolCall)
        dispatch({ type: "ADD_TOOL_CALL", toolCall })
      }

      if (tc.args) {
        // 累积 args，尝试解析
        const toolCall = currentAssistantMsg?.toolCalls.find(t => t.id === tc.id)
        if (toolCall) {
          toolCall.input = tryParseArgs(toolCall.input, tc.args)
          if (toolCall.input) {
            toolCall.state = "input-ready"
            dispatch({ type: "UPDATE_TOOL_CALL", toolCallId: tc.id, updates: { input: toolCall.input, state: "input-ready" } })
          }
        }
      }
    }
  }
}

function handleUpdatesEvent(payload: any) {
  const data = payload.data
  if (data.tools?.messages) {
    for (const msg of data.tools.messages) {
      const kwargs = msg?.kwargs || msg
      const toolCallId = kwargs.tool_call_id
      const content = kwargs.content ?? ""
      const outputText = typeof content === "string" ? content : JSON.stringify(content)

      dispatch({
        type: "UPDATE_TOOL_CALL",
        toolCallId,
        updates: { output: outputText, state: "completed" },
      })
    }
  }
}

function handleInterruptEvent(payload: any) {
  const interrupts = payload.interrupts || []
  for (const interrupt of interrupts) {
    const actionRequests = interrupt?.value?.actionRequests || []
    for (const action of actionRequests) {
      dispatch({
        type: "UPDATE_TOOL_CALL",
        toolCallId: action.toolCallId || findToolCallIdByName(action.name),
        updates: { state: "approval-requested", input: action.args },
      })
    }
  }
  dispatch({ type: "SET_STATUS", status: "waiting-approval" })
}
```

---

## 四、审批流程

### 4.1 审批 UI

```tsx
function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const { resumeAfterApproval } = useManualChatContext()

  if (toolCall.state === "approval-requested") {
    return (
      <div className="tool-card">
        <div className="tool-header">{toolCall.name}</div>
        <pre>{JSON.stringify(toolCall.input, null, 2)}</pre>
        <div className="tool-actions">
          <button onClick={() => handleApprove(toolCall.id)}>批准</button>
          <button onClick={() => handleReject(toolCall.id)}>拒绝</button>
        </div>
      </div>
    )
  }

  // 其他状态渲染...
}

function handleApprove(toolCallId: string) {
  // 更新本地状态
  dispatch({
    type: "UPDATE_TOOL_CALL",
    toolCallId,
    updates: { state: "approved", approvalResponse: { approved: true } },
  })

  // 检查是否所有工具都已响应
  const allResponded = checkAllToolsResponded()
  if (allResponded) {
    const decisions = buildResumeDecisions()
    resumeAfterApproval(decisions)
  }
}
```

### 4.2 Resume 决策构建

```typescript
function buildResumeDecisions(): Record<string, { type: string }> {
  const decisions: Record<string, { type: string }> = {}

  for (const msg of state.messages) {
    for (const tc of msg.toolCalls) {
      if (tc.state === "approved") {
        decisions[tc.id] = { type: "approve" }
      } else if (tc.state === "rejected") {
        decisions[tc.id] = { type: "reject" }
      }
    }
  }

  return decisions
}
```

---

## 五、渲染组件

### 5.1 消息列表

```tsx
function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="messages">
      {messages.map((msg) => (
        <div key={msg.id} className={`message ${msg.role}`}>
          {msg.role === "assistant" && <Avatar />}
          <div className="message-content">
            {msg.content && <TextBlock text={msg.content} />}
            {msg.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        </div>
      ))}
      {status === "streaming" && <StreamingIndicator />}
    </div>
  )
}
```

### 5.2 文本渲染

```tsx
function TextBlock({ text }: { text: string }) {
  // 使用 Markdown 渲染
  const rendered = useMemo(() => renderMarkdown(text), [text])
  return <div className="text-block" dangerouslySetInnerHTML={{ __html: rendered }} />
}
```

---

## 六、完整流程图

```
用户输入 "查看文件"
  ↓
sendMessage("查看文件")
  ↓
dispatch({ type: "ADD_USER_MESSAGE", message: { role: "user", content: "查看文件" } })
  ↓
POST /raw-stream { message: "查看文件" }
  ↓
processStream(response.body)
  ↓
dispatch({ type: "START_STREAM" })
  ↓
解析 SSE 事件:
  ├── "messages" + content → 追加到 currentAssistantMsg.content
  ├── "messages" + tool_call_chunks → 创建 ToolCall，state: "calling"
  │   └── args 累积完整 → state: "input-ready"
  ├── "updates" + tools.messages → 匹配 toolCallId → state: "completed"
  └── "interrupt" → state: "approval-requested"
      ↓
dispatch({ type: "SET_STATUS", status: "waiting-approval" })
      ↓
渲染审批 UI (ToolCallCard)
      ↓
用户点击"批准"
      ↓
dispatch({ type: "UPDATE_TOOL_CALL", state: "approved" })
      ↓
checkAllToolsResponded() → true
      ↓
resumeAfterApproval({ toolCallId: { type: "approve" } })
      ↓
POST /raw-stream/resume { resumeDecisions: { ... } }
      ↓
processStream(response.body)
      ↓
继续解析 SSE 事件 → 新内容追加到新的 assistant message
```

---

## 七、优缺点对比

### 7.1 优势

| 优势 | 说明 |
|------|------|
| **完全可控** | 消息状态、渲染逻辑、审批流程完全自定义 |
| **无黑盒** | 不依赖 AI SDK 内部状态管理，调试简单 |
| **包体积小** | 不需要 `ai`、`@ai-sdk/react` 等依赖 |
| **灵活扩展** | 可轻松添加自定义功能（如消息编辑、撤销） |
| **无兼容问题** | 不受 AI SDK 版本升级影响 |

### 7.2 劣势

| 劣势 | 说明 |
|------|------|
| **代码量大** | 需要自建消息管理、SSE 解析、状态机 |
| **维护成本** | 所有逻辑自行维护，无社区支持 |
| **缺少高级功能** | 需要自己实现 streaming 动画、错误重试、断线重连等 |
| **审批状态同步** | 需要手动管理 toolCall 状态转换 |
| **多轮对话管理** | 需要自己处理消息历史、分页、加载等 |

---

## 八、实现工作量估算

| 模块 | 代码量 | 复杂度 |
|------|--------|--------|
| 消息状态管理 (useReducer) | ~80 行 | 低 |
| SSE 解析器 | ~100 行 | 中 |
| 工具调用追踪 | ~60 行 | 中 |
| 审批流程 | ~50 行 | 低 |
| 消息渲染组件 | ~80 行 | 低 |
| 错误处理/重试 | ~40 行 | 中 |
| **总计** | **~410 行** | |

对比当前方案 (~500 行 transport + view 改动)，手动渲染的代码量相当，但**所有逻辑都需要自行实现和测试**。

---

## 九、建议

### 9.1 当前方案已足够

当前 `SimpleAgentsTransport` + `useChat` 方案：

- 已经解决了所有已知问题（tool_call_chunks 解析、interrupt 匹配、resume 流程）
- AI SDK 提供了消息管理、状态同步、错误处理等基础设施
- 代码量与手动渲染相当，但维护成本更低

### 9.2 何时考虑手动渲染

- AI SDK 出现无法绕过的 bug
- 需要完全自定义的消息渲染（如 3D 可视化、特殊动画）
- 团队有充足资源维护自定义消息系统

### 9.3 渐进式迁移策略

如果未来需要迁移到手动渲染，可以：

1. **先保留 useChat**，同时实现手动渲染的 hook
2. **对比两者输出**，确保消息状态一致
3. **逐步切换**，先切换普通消息，再切换工具调用，最后切换审批流程
4. **验证无误后**移除 useChat 依赖
