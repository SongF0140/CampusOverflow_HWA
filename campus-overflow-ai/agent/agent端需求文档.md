# Agent 服务需求文档（第一阶段 MVP）

## 1. 服务定位与边界

Agent 服务是独立的 TypeScript 服务（Vercel AI SDK + Hono，Node ≥ 22 ESM），负责智能编排：感知请求或事件、调用白名单工具获取上下文、生成结构化建议、自检并记录运行过程。

**必须做**：

- 使用 Vercel AI SDK 调用模型，维护单 Agent Loop 与 task router。
- 经 FastAPI 白名单接口读写持久化记忆与业务上下文。
- 生成结构化建议，流式输出。
- 自检输出是否满足格式、来源和风险要求。
- 记录每次运行的 agent_run_id 与 trace id。
- MCP 第一阶段仅以 mock 工具验证白名单与策略（真实 MCP Server 接入为第二阶段）。

**禁止做（硬边界）**：

- 不直接连接 MySQL，不直接写核心业务表。
- 不执行删帖、隐藏内容、封号，只能创建审批工单。
- 不访问 .env、密钥文件、数据库备份和非白名单目录。
- 不调用未在 `agent/src/tools/registry.ts` 注册的工具。
- 不在日志、记忆、输出中保存密码、密钥、Cookie、隐私原文。

## 2. 触发来源

| 触发来源 | 说明 | MVP 示例 |
| -------- | ---- | -------- |
| 用户主动请求 | 前端按钮经 BFF 转发 | 推荐标签、推荐相似问题 |
| 系统事件 | FastAPI 事件通知 | 新问题、新回答、新评论发布（触发内容风险扫描） |
| 管理员请求 | 后台操作 | 重新审核 |

## 3. 功能需求

### 3.1 Agent Loop 主循环

每次运行按以下步骤执行，且每步可观测：

```text
1. Observe:  接收用户请求或系统事件
2. Classify: 判断任务类型和风险等级
3. Plan:     规划所需上下文和工具
4. Act:      调用白名单工具或模型
5. Reflect:  自检结果是否可靠、有来源、未越权
6. Record:   写入 agent_runs 和 tool_call_logs
7. Respond:  返回建议或创建待审核工单
8. Remember: 将可复用上下文写入持久化记忆
9. Trace:    全程挂载同一 trace id
10. Approve: 高风险动作创建人工确认请求
```

验收标准：

- 每次运行有唯一 agent_run_id，全程携带同一 trace id。
- 循环必须有停止条件（最大迭代次数 / 任务完成 / 自检失败），不允许死循环。
- 自检失败时不得把未通过校验的输出返回给用户。

### 3.2 任务路由与任务处理器

第一阶段只做单 Agent Loop + task router，不实现多 Agent 协作；`agent/src/agents/` 仅作为第二阶段扩展点。

| 任务处理器 | 职责 | 可调用工具示例 |
| ---------- | ---- | -------------- |
| supervisor | 任务分类、统一风险策略、结果自检 | classifyTask、createApprovalRequest |
| retrieval | 站内检索、相似问题候选、上下文整理 | searchQuestions、getQuestionDetail、readMemory |
| moderation | 内容风险判断、审核快照与工单建议 | createModerationSnapshot、createModerationCase |

MVP 任务类型与风险等级：

| 任务 | 风险 | 行为 |
| ---- | ---- | ---- |
| suggest_tags | 低 | 返回推荐标签及理由，用户确认后才写入 |
| similar_questions | 低 | 返回相似问题列表与链接 |
| moderation_scan | 高 | 创建审核快照和审核工单 |
| memory_update | 低/中 | 写入用户偏好、课程上下文、任务经验 |

验收标准：

- 不同任务由 task router 正确分发给对应处理器。
- 所有处理器共享同一工具注册表、记忆层、审批策略和 trace 上下文。
- 低风险任务直接返回建议；高风险任务（moderation_scan）必须进入审核工单。

### 3.3 工具白名单

工具统一在 `agent/src/tools/registry.ts` 注册，未注册工具不可被调用。

| 工具名 | 调用目标 | 用途 | 是否可写 |
| ------ | -------- | ---- | -------- |
| searchQuestions | FastAPI | 检索历史问题 | 否 |
| getQuestionDetail | FastAPI | 获取问题详情 | 否 |
| getCourseContext | FastAPI | 获取课程上下文 | 否 |
| listTags | FastAPI | 获取已有标签 | 否 |
| getUserPublicProfile | FastAPI | 获取公开用户信息 | 否 |
| readMemory | FastAPI | 读取相关记忆 | 否 |
| writeMemory | FastAPI | 写入可复用记忆 | 是 |
| createModerationCase | FastAPI | 创建审核工单 | 是 |
| createModerationSnapshot | FastAPI | 保存审核快照 | 是 |
| createApprovalRequest | FastAPI | 创建人工确认请求 | 是 |

高风险工具调用必须满足：

- 携带操作者身份与请求参数摘要。
- 记录模型判断原因。
- 不执行永久删除，不直接执行封号。

### 3.4 持久化记忆

记忆读写放 `agent/src/memory/`，只调用 FastAPI 内部接口，实际存储在 MySQL。

| 类型 | 用途 | 示例 |
| ---- | ---- | ---- |
| user_preference | 用户偏好 | 常用标签、常问课程 |
| course_context | 课程上下文 | 高频问题摘要、常见知识点 |
| task_experience | 任务经验 | 审核误判修正、标签推荐反馈 |

验收标准：

- 只写摘要，不写敏感原文；写入前后都执行敏感信息过滤。
- 写入必须带来源对象和 agent_run_id。
- 用户相关记忆支持用户删除或禁用。
- 读取按任务上下文筛选，避免无关记忆污染输出。

### 3.5 Human-in-the-loop 审批

高风险操作统一进入 `approval_requests`，相关代码放 `agent/src/approvals/`。

MVP 需要审批的动作：内容隐藏或删除建议、封禁建议、可能影响用户权益的自动化建议。

审批状态流转：`pending → approved → executed`；`pending → rejected`；`pending → expired`。

验收标准：

- 审批记录关联 agent_run_id、tool_call_log_id、操作类型、风险等级、模型原因、证据快照。
- Agent 侧只创建审批请求，不执行最终动作；执行由 FastAPI 在人工确认后完成。

### 3.6 流式输出与前端交互

- 通过 SSE 流式输出，前端使用 `@ai-sdk/react` 消费。
- 必须支持生成中、失败重试、需要人工确认（approval-needed）三种状态。
- AI 建议必须标注 AI 属性，不自动作为正式内容发布。

## 4. 接口需求

### 4.1 对外提供（端口 8787）

| 接口 | 方法 | 说明 |
| ---- | ---- | ---- |
| /agent/suggest-tags | POST | 推荐问题标签（含理由与置信度） |
| /agent/similar-questions | POST | 推荐相似问题（含链接与原因） |
| /agent/moderation/scan | POST | 扫描内容风险，命中则建快照与工单 |
| /agent/runs/{id} | GET | 查询 Agent 运行状态 |
| /agent/events/poll | POST | 静默巡检事件拉取或触发 |

### 4.2 依赖的 FastAPI 白名单接口

仅允许调用 `/internal/agent/*`，必须携带服务间 token 与 `x-trace-id`：

| 接口 | 方法 | 用途 | 对应任务 |
| ---- | ---- | ---- | -------- |
| /internal/agent/questions/search | GET | 检索问题候选集 | similar_questions |
| /internal/agent/questions/{id} | GET | 获取问题详情 | similar_questions、moderation_scan |
| /internal/agent/courses/{id}/context | GET | 获取课程上下文 | suggest_tags |
| /internal/agent/tags | GET | 获取标签列表 | suggest_tags |
| /internal/agent/moderation/cases | POST | 创建审核工单 | moderation_scan |
| /internal/agent/moderation/snapshots | POST | 创建审核快照 | moderation_scan |
| /internal/agent/runs | POST | 创建或更新运行记录 | 全部 |
| /internal/agent/tool-calls | POST | 写入工具调用日志 | 全部 |
| /internal/agent/memories/search | GET | 检索相关记忆 | 全部 |
| /internal/agent/memories | POST | 写入记忆 | memory_update |
| /internal/agent/approvals | POST | 创建人工确认请求 | moderation_scan |

要求：

- 使用服务间 token 鉴权，透传或生成 trace id。
- 响应只含必要字段，不返回密码、验证码、密钥、私密日志。
- 写接口必须记录 agent_run_id。

## 5. 非功能需求

- **测试**：vitest，mock LLM、mock FastAPI、mock MCP，单元测试不依赖真实网络；工具注册、task router、记忆过滤、审批触发、trace 透传为必测路径。
- **降级**：Agent 服务不可用时，提问、回答等核心问答流程完全不受影响。
- **部署**：支持 Docker Compose 容器化，与 frontend/backend/MySQL 同编排。

## 6. MVP 验收清单

- [ ] suggest_tags、similar_questions、moderation_scan、memory_update 四类任务可用
- [ ] 流式输出端到端可演示（生成中 / 失败重试 / 人工确认三态）
- [ ] 每次运行有唯一 agent_run_id 与 trace id
- [ ] 未注册工具无法被调用（有测试证明）
- [ ] Agent 代码库中无直连 MySQL 代码（grep 可查）
- [ ] 未带凭证调用内部接口被拒绝（401）
- [ ] 含密码/密钥/隐私原文的记忆写入被拒绝并留拦截日志
- [ ] Agent 无法直接删帖/封号，只能创建待确认工单
- [ ] vitest 全部通过，eslint 零 error
