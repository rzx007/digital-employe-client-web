## 目标架构

```
┌─────────────────────────────────────┐
│           Base Layer (全局)          │
│  Global Skills + Global MCPs        │
│  始终加载，所有对话共享               │
└──────────────────┬──────────────────┘
                   │ 叠加
┌──────────────────▼──────────────────┐
│        Employee Layer (员工)         │
│  员工专属 Prompt + Skills + MCPs     │
│  切换员工时随之切换                   │
└──────────────────┬──────────────────┘
                   │ 关联
┌──────────────────▼──────────────────┐
│        Session Layer (对话)          │
│  每个员工下可有多个对话               │
│  已有 ✓                             │
└─────────────────────────────────────┘
```

## 员工概念 + 分层 Skills

### 当前架构总览

```
data/
  skills/                           ← 全局技能（所有员工共享）
    code-review/
      SKILL.md
    file-analysis/
      SKILL.md
  employees/                        ← 员工目录
    {employeeId}/
      skills/                       ← 员工专属技能
        sql-expert/
          SKILL.md
  workspace/
    {sessionId}/                    ← 会话工作区
      skills/          → junction → data/skills/           （只读链接）
      employee-skills/ → junction → data/employees/{eid}/skills/  （只读链接）
      a.txt                        ← agent 生成的文件
      output.csv
```

### 目录结构

`src/config.ts` 管理两个核心目录：

| 目录 | 用途 | 独立模式 | Electron 模式 |
|------|------|----------|---------------|
| `dataDir` | 运行时可写数据 | `cwd()/data/` | `app.getPath("userData")/agent-data/` |
| `resourcesDir` | 只读资源 | `cwd()/` | dev: `apps/simple-agents/`, prod: `process.resourcesPath/simple-agents/` |

```
dataDir/                          resourcesDir/
  ├── simple-agents.db              ├── migrations/
  ├── skills/                       └── static/
  ├── employees/
  └── workspace/
      {sessionId}/
        skills/          → junction → dataDir/skills/
        employee-skills/ → junction → dataDir/employees/{eid}/skills/
        (agent 生成的文件)
```

配置通过 `setup()` 传入：

```typescript
// 独立模式（无参数，使用默认值）
setup()

// Electron 模式（显式指定路径）
setup({ dataDir, resourcesDir })
```

### 数据层

```
employees
├── id (PK)              = 管理端 user_id
├── name                 = 管理端 employee_name
├── systemPrompt         = 管理端 system_prompt
├── description
├── capabilities (JSON)  = 管理端 capabilities 数组，前端展示用
├── skills (JSON)        = 管理端 skills 数组，前端展示用（非实际 SKILL.md）
├── createdAt / updatedAt

sessions
├── id (PK)
├── employeeId → employees.id (ON DELETE SET NULL)
├── title, metadata, isArchived
├── createdAt / updatedAt

messages / artifacts / stream_tasks（不变）

messages / artifacts / stream_tasks (已有，不变)
```

### 员工来源

| 方式 | 接口 | 说明 |
|------|------|------|
| 管理端导入（主流程） | `POST /api/employees/import/:userId` | 从管理端拉数据+技能zip，upsert DB |
| 重新同步 | `POST /api/employees/:id/sync` | 管理端改了员工/技能后更新 |
| 本地创建（开发用） | `POST /api/employees` | 手动指定 name/systemPrompt |


### 导入/同步流程：
```
POST /api/employees/import/9368
  → GET {MANAGEMENT_BASE_URL}/employees/9368       → 拉员工数据
  → GET {MANAGEMENT_BASE_URL}/employees/9368/skills.zip → 下载技能
  → 解压到 data/employees/9368/skills/
  → upsert DB（含 capabilities + skills JSON）
  → invalidateAgentCache()
```

### Agent 工厂 + 缓存

```
getAgent(employeeId, systemPrompt?)
  ├── 缓存命中 → 直接返回
  └── 缓存未命中 → createDeepAgent({
        model: GLM-4.7,
        systemPrompt: 员工专属 || 默认,
        skills: ["/skills/", "/employee-skills/"],   ← 相对 backend rootDir
        backend: FilesystemBackend({ rootDir: workspace/{sid} })
      })
      → 缓存到 Map<employeeId, Agent>
```

### 对话流程

```
1. 创建员工:  POST /api/employees { name, systemPrompt, description }
              → DB 插入 + 创建 data/employees/{id}/skills/

2. 创建会话:  POST /api/sessions { employeeId }
              → DB 插入 + 创建 workspace/{sid}/
              → junction: workspace/{sid}/skills → data/skills/
              → junction: workspace/{sid}/employee-skills → data/employees/{eid}/skills/

3. 发起对话:  POST /api/sessions/{sid}/chat/stream
              → 从 session 获取 employeeId
              → getAgent(employeeId) 获取缓存的 Agent
              → Agent 通过 backend 在 workspace/{sid}/ 下工作
              → SkillsMiddleware 自动扫描 skills/ 和 employee-skills/ 下的 SKILL.md
```

### 技能加载机制（DeepAgents 内部）

```
创建 Agent 时指定 skills: ["/skills/", "/employee-skills/"]
                ↓
SkillsMiddleware 在每次调用时通过 backend.globInfo() 扫描
                ↓
查找 */SKILL.md，解析 YAML frontmatter（name + description）
                ↓
将技能摘要注入 system prompt（渐进式披露）
                ↓
Agent 需要时通过 read_file 工具读取完整 SKILL.md
                ↓
（通过 junction 链接，实际读取的是 data/skills/ 下的源文件）
```

### 缓存失效

| 场景 | 触发 |
|------|------|
| 更新员工 systemPrompt | `updateEmployee()` → `invalidateAgentCache(id)` |
| 删除员工 | `deleteEmployee()` → `invalidateAgentCache(id)` + 删除目录 |
| 更新全局/员工技能文件 | **无需任何操作**（junction 实时引用） |

### API 端点

```
员工:
  POST   /api/employees                    - 本地创建
  POST   /api/employees/import/:userId     - 管理端导入
  POST   /api/employees/:id/sync           - 重新同步
  GET    /api/employees                    - 列表
  GET    /api/employees/:id                - 详情
  PATCH  /api/employees/:id                - 更新
  DELETE /api/employees/:id                - 删除

会话:
  POST   /api/sessions                     - 创建（employeeId 可选）
  GET    /api/sessions?employeeId=         - 列表（支持过滤）
  GET    /api/sessions/:id                 - 详情
  PATCH  /api/sessions/:id                 - 更新
  DELETE /api/sessions/:id                 - 删除

对话:
  POST   /api/sessions/:id/chat            - 同步
  POST   /api/sessions/:id/chat/stream     - SSE 流式
  GET    /api/sessions/:id/stream          - 流状态
  GET    /api/sessions/:id/stream/:sid     - 恢复流
  POST   /api/sessions/:id/stream/:sid/cancel

消息/产物: GET/DELETE /api/sessions/:id/messages|artifacts
```