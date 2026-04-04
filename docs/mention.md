Now I have a complete understanding. Here's the plan:

---

## @ Mention 功能实施计划

### 数据流

```
ChatPanel (contact) 
  → 计算提及候选人（群聊: participants / 主理人: 所有员工）
    → ChatPromptInput (mentionCandidates)
      → LexicalPromptInputTextarea (mentionCandidates)
        → MentionPlugin (触发@菜单, 选中后插入 MentionPillNode)
        → OnChangePlugin (提取 mentions 数据 → PromptChangeEvent.mentions)
```

### 涉及文件

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| 1 | `mention-pill-node.tsx` | **新建** | `MentionPillNode` 装饰节点，渲染 `@张三` 样式 pill |
| 2 | `mention-plugin.tsx` | **新建** | `@` 触发菜单插件，复用 `LexicalTypeaheadMenuPlugin` 模式 |
| 3 | `prompt-input-textarea.tsx` | 修改 | 注册 `MentionPillNode`，引入 `MentionPlugin`，扩展 `getEditorCommandAndValue` 提取 mentions，`PromptChangeEvent` 新增 `mentions` 字段 |
| 4 | `chat-prompt-input.tsx` | 修改 | 新增 `mentionCandidates` prop 透传给 Lexical |
| 5 | `chat-panel.tsx` | 修改 | 根据 `contact.type` 计算提及候选人并传递 |

### 详细步骤

#### Step 1: 新建 `mention-pill-node.tsx`

仿照 `command-pill-node.tsx`，创建 `MentionPillNode extends DecoratorNode`：

- 存储字段：`__mentionId`, `__mentionName`
- 渲染：`@Name` 样式，使用浅蓝背景 pill 区分于命令 pill 的主色
- `getTextContent()` 返回 `""`（不参与纯文本计算）
- `exportJSON()` / `importJSON()` 支持序列化

```typescript
// 渲染样式：不同于 CommandPill 的 primary 背景
"@张三"  // rounded pill, bg-blue-100 dark:bg-blue-900/30, text-blue-700
```

#### Step 2: 新建 `mention-plugin.tsx`

仿照 `slash-command-plugin.tsx`：

- 触发字符：`@`，`useBasicTypeaheadTriggerMatch("@", { minLength: 0 })`
- 候选人数据类型：

  ```typescript
  export interface MentionCandidate {
    id: string
    name: string
    avatar?: string
    role?: string
  }
  ```

- 菜单样式：显示头像 + 姓名 + 角色，支持输入文字过滤（按 name/role 模糊匹配）
- 选中行为：移除触发 `@` 文本，插入 `$createMentionPillNode(id, name)` + 空格
- 仅当 `mentionCandidates.length > 0` 时激活插件

#### Step 3: 修改 `prompt-input-textarea.tsx`

1. **扩展 `PromptChangeEvent`**：

   ```typescript
   export interface PromptChangeEvent {
     value: string
     rawValue: string
     command: { id: string; title: string } | null
     mentions: Array<{ id: string; name: string }>  // 新增
   }
   ```

2. **扩展 `getEditorCommandAndValue`**：遍历节点树提取所有 `MentionPillNode`，收集为 `mentions` 数组

3. **`LexicalPromptInputTextareaProps`** 新增：

   ```typescript
   mentionCandidates?: MentionCandidate[]
   ```

4. **`initialConfig.nodes`** 注册 `MentionPillNode`

5. **JSX** 中渲染 `<MentionPlugin candidates={mentionCandidates} />`

#### Step 4: 修改 `chat-prompt-input.tsx`

- `ChatPromptInputProps` 新增 `mentionCandidates?: MentionCandidate[]`
- 透传给 `LexicalPromptInputTextarea`

#### Step 5: 修改 `chat-panel.tsx`

- 从 `contact` 计算提及候选人：

  ```typescript
  const mentionCandidates = useMemo<MentionCandidate[]>(() => {
    if (contact?.type === "group") {
      return (contact.group?.participants ?? []).map(p => ({
        id: p.id, name: p.name, avatar: p.avatar, role: p.role
      }))
    }
    if (contact?.type === "curator") {
      // 主理人 = 所有员工都可@（后续从 store 取）
      return [] // TODO: 从 contacts store 获取全部员工
    }
    return []
  }, [contact])
  ```

- 传递 `mentionCandidates` 给 `ChatPromptInput`

### 不涉及的文件

- `chat-draft-view.tsx` / `chat-conversation-view.tsx` — 无需修改，`ChatPanel` 内部自行计算候选人
- 发送消息时的 mentions 数据暂不处理（后端对接时再扩展 `PromptInputMessage`）

### 关键设计决策

| 决策 | 方案 |
|------|------|
| 菜单样式 | 仿 slash-command 的 FloatingMenu，用 Portal + fixed 定位 |
| Pill 样式 | 浅蓝背景区分于命令 pill，`@` 前缀 + 姓名 |
| 搜索匹配 | 输入 `@` 后的文字按 name/role 模糊匹配 |
| 空候选人 | 当 `mentionCandidates` 为空数组时，`MentionPlugin` 不渲染（return null） |
| 主理人候选人 | 初期返回空数组，后续接入 store 获取全部员工列表 |
