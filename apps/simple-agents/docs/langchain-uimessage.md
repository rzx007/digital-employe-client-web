# 流转换流程分析

## 架构概览
```

┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React 19)                         │
│  apps/web/src/components/chat/chat-conversation-view.tsx:38        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  useChat({ transport: chatTransport, id, messages })        │   │
│  │     ↓ sendMessage()                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                            ↓                                       │
│  apps/web/src/lib/chat/langchain-chat-transport.ts:8                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  SimpleAgentsChatTransport.sendMessages()                    │   │
│  │  POST /simple-agents/api/sessions/:id/chat/stream           │   │
│  │  → processResponseStream(response.body)                      │   │
│  │  → 解析 SSE data → UIMessageChunk → enqueue                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Vite proxy (/simple-agents → :3005)
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     Backend (Hono :3001/:3005)                     │
│  apps/simple-agents/src/routes/chat.ts:80                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  POST /:id/chat/stream                                      │   │
│  │  → chatStreamResponse(sessionId, message, employeeId)       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                            ↓                                       │
│  apps/simple-agents/src/services/agent-service.ts:92                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  1. createMessage(sessionId, "user", message)                │   │
│  │  2. resolveAgent(employeeId) → getAgent(cacheKey, prompt)   │   │
│  │  3. agent.streamEvents({messages}, config)                   │   │
│  │  4. toUIMessageStream(eventStream)                           │   │
│  │     ↑ @ai-sdk/langchain adapter                             │   │
│  │  5. createUIMessageStream({ writer.merge(uiStream) })       │   │
│  │  6. createUIMessageStreamResponse({ stream })                │   │
│  │  7. onFinish → persistAssistantMessage → DB                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                            ↓                                       │
│  apps/simple-agents/src/agent.ts:93                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  createDeepAgent({                                           │   │
│  │    model: ChatOpenAI("glm-4.7"),                             │   │
│  │    systemPrompt,                                             │   │
│  │    skills: ["/skills/", "/employee-skills/"],                │   │
│  │    backend: (runtime) → FilesystemBackend(rootDir)           │   │
│  │  })                                                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## 关键流程拆解

1. 前端发送消息 (chat-conversation-view.tsx:38)
  - useChat 使用 SimpleAgentsChatTransport 作为 transport
  - sendMessage({ text }) 传入 body: { conversationId } 用于路由

2. Transport 层 (langchain-chat-transport.ts:8-48)
  - 从 body.conversationId 提取 sessionId
  - POST 到 /simple-agents/api/sessions/:id/chat/stream
  - 响应 body 是 ReadableStream<Uint8Array> (SSE 格式)
  - processResponseStream() 手动解析 SSE data: 行 → JSON.parse → UIMessageChunk enqueue
3. 后端路由 (routes/chat.ts:80-98)
  - 验证 session 存在，提取 employeeId
  - 调用 chatStreamResponse()

4. Agent 服务 - AI SDK 流 (agent-service.ts:92-123)
  - 保存用户消息到 DB

  - resolveAgent() 按 employeeId 查系统提示词，获取缓存的 DeepAgent 实例
  - 获取历史消息，调用 agent.streamEvents() (LangChain 原始事件流)
  - 核心桥接: toUIMessageStream(eventStream) — @ai-sdk/langchain 自动将 LangChain  
  - streamEvents 转换为 ReadableStream<UIMessageChunk>
  - 用 createUIMessageStream() 包装，添加 onFinish 回调持久化助手回复

5. Agent 工厂 (agent.ts:93-113)

  - createDeepAgent() 创建基于 LangGraph 的 Agent
  - 按 employeeId 缓存实例（Map<string, any>）
  - 每个 Agent 有独立的 systemPrompt、skills 路径、FilesystemBackend

  ## 两条流式通道对比
| 特性 | /chat/stream (AI SDK) | /chat/raw-stream (Raw) |
|------|------------------------|-------------------------|
| 核心转换 | @ai-sdk/langchain toUIMessageStream() | 手动 for await 迭代 streamEvents |
| 输出格式 | 标准 UIMessageChunk SSE | 自定义 StreamEvent SSE |
| 前端消费 | useChat + ChatTransport 直接消费 | 自定义 SSE 解析（需 langchain-stream-parser.ts） |
| 断线重连 | 不支持（reconnectToStream → null） | 支持（stream-registry + 三级降级） |
| 后台任务 | 不支持（连接断开=流结束） | 支持（agent 与 SSE 解耦） |
| 持久化 | onFinish 回调中保存 | 实时 flush 到 DB |
| 当前使用 | 主通道（production） | 备用/高级场景 |


`@ai-sdk/langchain` 的作用

在 `agent-service.ts:111`:

```ts
const uiStream = toUIMessageStream(eventStream)
```

这是整个系统的桥梁——将 `agent.streamEvents()` 返回的 `LangChain AsyncIterable<StreamEvent>` 自动转换为 AI SDK 兼容的 `ReadableStream<UIMessageChunk>`，使前端 useChat 可以直接消费，无需手动解析 `LangChain` 事件格式。

`langchain-stream-parser.ts` 的角色
这个文件（587行）是一个独立的备用解析器，用于 `raw-stream` 场景。它手动处理 `LangChain AIMessageChunk / ToolMessage` 的复杂协议：

- 工具调用的分片组装`（tool_calls + tool_call_chunks + invalid_tool_calls）`

- 文本/工具阶段的转换（`idle → text → tool → text）`
- 生成正确的 UIMessageChunk 生命周期事件`（text-start → text-delta → text-end，tool-input-start → tool-input-delta → tool-input-available)`

当前主流程并未使用此解析器——AI SDK 通道通过 `@ai-sdk/langchain` 的 `toUIMessageStream()` 自动处理了这些转换。