现在全貌清楚了。以下是完整的集成方案：

---

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

要开始实施吗？从哪个 Phase 开始？