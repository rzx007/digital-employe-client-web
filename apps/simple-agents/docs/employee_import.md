## 实施计划：从管理端导入员工 + 技能同步

### 环境变量

```env
# 管理端地址（不配置则导入/同步接口返回错误提示）
MANAGEMENT_BASE_URL=http://localhost:3000
```

接口路径模板硬编码在代码中（管理端未定，后续可直接改常量）：

```
员工数据: {MANAGEMENT_BASE_URL}/employees/{userId}        → JSON
技能下载: {MANAGEMENT_BASE_URL}/employees/{userId}/skills.zip → zip
```

### 新增 API 端点

```
POST /api/employees/import/:userId   → 从管理端导入员工（首次）
POST /api/employees/:id/sync         → 重新同步（数据+技能）
```

保留现有 CRUD（创建/列表/更新/删除），本地创建时跳过同步。

### 执行逻辑

**导入员工 `POST /api/employees/import/:userId`：**

```
1. 检查 MANAGEMENT_BASE_URL 是否配置
2. GET {baseUrl}/employees/{userId} 获取员工数据
3. 响应非 200 → 返回 502（上游错误）
4. 映射字段：
   userId        → id
   employee_name → name
   system_prompt → systemPrompt
   description   → description
   user_id       → metadata.userId
5. 本地 DB upsert（存在则更新，不存在则创建）
6. 创建 data/employees/{id}/skills/ 目录
7. GET {baseUrl}/employees/{userId}/skills.zip 下载技能
8. 技能下载成功 → 清空目录 + 解压
9. 技能下载失败 → warn 日志，不阻塞（员工已创建，只是没技能）
10. 失效 agent 缓存
11. 返回员工对象
```

**重新同步 `POST /api/employees/:id/sync`：**

```
1. 检查员工是否存在于本地 DB
2. 重复导入流程的步骤 2-10
```

### 变更文件

| 操作 | 文件 | 说明 |
|------|------|------|
| **新增依赖** | `package.json` | `extract-zip` |
| **修改** | `src/services/employee-service.ts` | 新增 `importEmployee(userId)` + `syncEmployee(id)` |
| **修改** | `src/services/skill-service.ts` | 新增 `downloadAndExtractSkills(employeeId, zipUrl)` |
| **修改** | `src/routes/employees.ts` | 新增 2 个路由 |
| **修改** | `.env.example` | 新增 `MANAGEMENT_BASE_URL` |

### 容错策略

- `MANAGEMENT_BASE_URL` 未配置 → 返回 501 + 提示信息
- 管理端不可达 → 返回 502
- 技能 zip 下载失败 → 员工已保存，skills 目录为空，warn 日志
- zip 格式异常 → warn 日志，清空已有技能
- 重复导入同一 userId → upsert（更新 name/systemPrompt/description）

### 不做的事

- 不处理 capabilities 字段（后续 MCP 迭代）
- 不从管理端拉取全局技能
- 不处理 skills 数组（前端展示用）

有什么需要调整的吗？