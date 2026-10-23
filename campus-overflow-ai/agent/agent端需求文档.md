# Agent 服务需求文档（二期实施范围）

> **2026-10-23 首批受控运行主干交付状态（G-06 实现验证完成，待人工验收）**：G-01～G-06 全部实现验证与三服务批次收口完成（见 `../../docs/Agent层验证记录/G-06.md`）。已交付：双凭证可信身份解析、BFF → Agent → FastAPI 身份链路、聊天与四类任务统一的模型 PlanList 受控规划（累计 12 次工具/8 步/1 次返工/180 秒预算）、持久运行与步骤审计（创建失败阻断执行、记录失败终止）、总结自检与来源检查、超时取消，及跨服务隔离集成测试。单列限制（未交付）：真实模型联调、真实 MySQL 并发取证、进程崩溃恢复、三服务部署互通；个人记忆（T-14，浏览器隔离方案）、治理审批闭环（T-15）、管理端观测检索（T-16）、MCP（T-17）未实施，下文相关描述是后续验收目标。

> **2026-10-22 G-03-C 补充（实现验证完成，人工待审查）**：文档草稿已通过只读检索计划获取站内参考；风险扫描已通过白名单工具获取当前可见原文，目标与父级隐藏/删除均不可读。不能取得原文时返回理由明确标注使用请求方摘录、未核验原文，401/403 不降级。计划执行器基础已有独立提交，本补充不宣称所有任务与聊天均已统一为模型规划，也不代表工单、记忆、持久审计交付完成。

> **G-02 实现验证（2026-10-18，人工待审查）**：用户请求已接通 BFF Cookie → Agent Bearer → FastAPI principal；健康探针公开，其他 Agent 入口先验证身份。用户检索走新增 `/internal/agent/user/*` 双凭证入口，请求级客户端和工具表隔离凭证，数据请求逐次复核身份，默认推荐任务客户端已接通。内存记录替换、PlanList、个人记忆与 Wiki 仍按后续任务实施，不能据此宣称完整闭环。

> **2026-10-18 设计增量**：用户确认采用受控 PlanList；个人记忆在本人授权范围内自动更新，教师不得读取学生个人记忆，管理员管理与审计独立授权；公共 Wiki 由 AI 提交草稿、管理员审核发布。目标设计见 `../../docs/Agent层设计与实施分期.md`，正式需求见 spec AG-R01～06，当前执行见 tasks G-01～G-06。新决定覆盖下文与之冲突的旧权限和编排描述，不代表后续分期已经实现。

> 状态（2026-10-10）：T-11 单 Agent Loop、T-12 内部白名单接口对接、T-13 标签与相似问题推荐已完成；记忆完整能力、治理审批、观测查询和 MCP Adapter 分别归 T-14~T-17。下文未完成能力是后续验收目标，不代表当前已交付。

## 1. 服务定位与边界

Agent 服务是独立的 TypeScript 服务（Vercel AI SDK + Hono，Node ≥ 22 ESM），负责智能编排：感知请求或事件、调用白名单工具获取上下文、生成结构化建议、自检并记录运行过程。

**必须做**：

- 使用 Vercel AI SDK 调用模型，维护单 Agent Loop 与 task router。
- 经 FastAPI 白名单接口读写持久化记忆与业务上下文。
- 生成结构化建议，流式输出。
- 自检输出是否满足格式、来源和风险要求。
- 记录每次运行的 agent_run_id 与 trace id。
- MCP 在 T-17 先以 mock 工具验证白名单与策略，再接真实 MCP Server。

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

当前采用单 Agent Loop + task router，不实现多 Agent 协作；`agent/src/agents/` 仅作为后续扩展点。

| 任务处理器 | 职责 | 可调用工具示例 |
| ---------- | ---- | -------------- |
| supervisor | 任务分类、统一风险策略、结果自检 | classifyTask、createApprovalRequest |
| retrieval | 站内检索、相似问题候选、上下文整理 | searchQuestions、getQuestionDetail、readMemory |
| moderation | 内容风险判断、审核快照与工单建议 | createModerationSnapshot、createModerationCase |

MVP 任务类型与风险等级：

> 当前状态：T-11/T-13 已注册 `suggest_tags`、`similar_questions`、`moderation_scan`、`doc_draft` 四种任务类型；只有前两种完成产品能力验收。`moderation_scan` 的工单闭环待 T-15，`doc_draft` 未被 spec 收录；下表中的 `memory_update` 是 T-14 目标，不是当前路由枚举。

| 任务 | 风险 | 行为 |
| ---- | ---- | ---- |
| suggest_tags | 低 | 返回推荐标签及理由，用户确认后才写入 |
| similar_questions | 低 | 返回相似问题列表与链接 |
| moderation_scan | 高 | 当前仅返回风险评估；T-15 才创建审核工单 |
| memory_update（未实现） | 低/中 | T-14 目标：写入用户偏好、课程上下文、任务经验 |

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

### 3.7 Agent 友好型建设与工具/消息/插件接入规范

**设计目标**：使 Agent 服务能够作为标准工具提供者、消息桥接实体和 MCP 插件宿主机，支持其他 Agent 和外部系统集成。

#### 3.7.1 可连接作为工具提供者

- 提供标准 **OpenAPI 3.0** 接口描述，其他 Agent 可通过服务发现机制自动加载
- 实现 `GET /agent/openapi.json` 端点，返回完整 API 描述文档
- 支持 **版本协商**（`Accept: application/vnd.agent.v1+json`）和格式标准化
- 所有工具接口遵循 RESTful 规范，包含完整的错误码和状态码定义

#### 3.7.2 消息路由与桥接

- 实现 **消息队列适配器**（RabbitMQ/Redis/Pulsar），支持事件驱动架构
- 消息格式采用 **CloudEvents 1.0** 标准，确保跨平台兼容性
  ```json
  {
    "specversion": "1.0",
    "type": "question.created",
    "source": "/questions",
    "id": "53d6f6c1-4d37-4c67-8e78-7796b894f2c3",
    "time": "2024-08-27T22:30:00Z",
    "datacontenttype": "application/json",
    "data": { ... }
  }
  ```
- 支持 **支流式排序、幂等消费、死信处理** 机制
- 消息生产者/消费者需实现重试与背压机制

#### 3.7.3 MCP 工具与插件接入标准

**工具注册表**：`agent/src/mcp/registry.ts`
```typescript
interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  schemaVersion: '1.0' | '2.0';
  instructions?: string;
  tags?: string[];
  version?: string;
  category?: string;
  enabled?: boolean;
}
```

**MCP Adapter 三层架构**：
1. **Registry 层**：工具白名单注册、版本管理、服务发现
   - `ai.mcp.registry.ts`：注册与查询机制
2. **Policy 层**：风险策略、调用隔离、监控分割
   - `ai.mcp.policy.ts`：审批链条、数据访问控制、租户隔离
3. **Adapter 层**：协议适配、权限校验、日志注入
   - `ai.mcp.adapter.ts`：连接管理、计费/限流、错误处理

#### 3.7.4 Agent 间通信协议

- 服务间调用必须使用认证与追踪机制：
  - **认证**：`X-Service-Token`（服务间凭证）
  - **追踪**：`x-trace-id`（贯穿整个调用链）
- 支持标准协议：
  - **gRPC**：高性能内部服务通信
  - **OpenAPI/REST**：通用 Web 接口
  - **WebSocket**：实时双向通信
- 连接管理：
  - 连接超时：`connectionTimeout: 5000ms`
  - 重试机制：指数退避，最大重试次数 3
  - 熔断隔离：舱壁模式，防止级联故障
  - 流量控制：令牌桶限流，默认 100  TPS

#### 3.7.5 可观测性增强

- **全链路追踪**：所有 Agent 间调用必须携带 `x-trace-id`
- **日志标准化**：结构化日志，包含 `agent_run_id` 和 `tool_call_id`
- **指标收集**：请求量、延迟、错误率、资源使用率
- **健康检查**：`GET /agent/healthz` 返回服务状态

## 4. 接口需求

### 4.1 对外提供（端口 8787）

| 接口 | 方法 | 说明 |
| ---- | ---- | ---- |
| /health、/agent/health | GET | 服务健康检查 |
| /agent/chat | POST | 演示用 SSE 流式对话与白名单工具调用 |
| /agent/tasks/suggest_tags | POST | 推荐问题标签（含理由与置信度） |
| /agent/tasks/similar_questions | POST | 推荐相似问题（含链接与原因） |
| /agent/tasks/moderation_scan | POST | 当前仅扫描并返回风险评估，审批闭环待 T-15 |
| /agent/tasks/doc_draft | POST | 路由骨架任务；spec 未收录，不作为交付契约 |

> `/agent/runs/{id}`、`/agent/events/poll` 及独立的 `/agent/suggest-tags`、`/agent/similar-questions` 均未实现。

### 4.2 依赖的 FastAPI 白名单接口

仅允许调用 `/internal/agent/*`，必须携带服务间 token 与 `x-trace-id`：

| 接口 | 方法 | 用途 | 对应任务 |
| ---- | ---- | ---- | -------- |
| /internal/agent/questions/search | GET | 检索问题候选集 | similar_questions |
| /internal/agent/courses/search | GET | 检索课程候选集 | chat / 检索工具 |
| /internal/agent/tags | GET | 获取标签列表 | suggest_tags |
| /internal/agent/runs | POST | 创建运行记录 | 全部 |
| /internal/agent/runs/{agent_run_id} | PATCH | 更新运行结果 | 全部 |
| /internal/agent/tool-calls | POST | 写入工具调用日志 | 全部 |
| /internal/agent/memory | GET / POST | 读取或写入记忆 | T-14 记忆闭环 |
| /internal/agent/approvals | POST | 创建人工确认请求 | moderation_scan |
| /internal/agent/moderation-cases/{case_id}/decision | PATCH | 更新工单决策（T-16 扩展） | moderation_scan |

> 上表是 T-12 已注册的真实路径；其中 memory、approvals、runs、tool-calls 的完整 Agent 侧持久化闭环分别由 T-14～T-16 完成。问题详情、课程上下文、审核快照等旧草案路径尚未注册。

要求：

- 使用服务间 token 鉴权，透传或生成 trace id。
- 响应只含必要字段，不返回密码、验证码、密钥、私密日志。
- 写接口必须记录 agent_run_id。

### 4.3 Agent 间通信与互操作性规范

**服务发现接口**：

| 接口 | 方法 | 说明 |
| ---- | ---- | ---- |
| /agent/openapi.json | GET | 返回 OpenAPI 3.0 描述文档 |
| /agent/services | GET | 列出可用服务元数据 |
| /agent/healthz | GET | 健康检查 |

**消息发布接口**（可选，第二阶段）：

| 接口 | 方法 | 说明 |
| ---- | ---- | ---- |
| /agent/events | POST | 发布 CloudEvents 事件 |
| /agent/subscriptions | POST | 订阅事件流 |
| /agent/webhooks | POST | 注册 HTTP Webhook |

**MCP 管理接口**：

| 接口 | 方法 | 说明 |
| ---- | ---- | ---- |
| /agent/mcp/tools | GET | 列出已注册 MCP 工具 |
| /agent/mcp/register | POST | 注册新 MCP 工具 |
| /agent/mcp/unregister | DELETE | 注销 MCP 工具 |

**Agent 间调用协议**：

- **认证**：服务间调用必须携带 `X-Service-Token` 头
- **追踪**：所有调用必须传递 `x-trace-id` 贯穿全链路
- **超时**：默认连接超时 5000ms，读写超时 30000ms
- **重试**：指数退避，最大重试 3 次
- **熔断**：实现舱壁隔离，错误率 > 10% 时熔断 30 秒 hv

## 5. 非功能需求

- **测试**：vitest，mock LLM、mock FastAPI、mock MCP，单元测试不依赖真实网络；工具注册、task router、记忆过滤、审批触发、trace 透传为必测路径。
- **降级**：Agent 服务不可用时，提问、回答等核心问答流程完全不受影响。
- **部署**：支持 Docker Compose 容器化，与 frontend/backend/MySQL 同编排。
- **可观测性**：所有 Agent 间调用必须携带 trace id；结构化日志包含 agent_run_id、tool_call_id；提供 Prometheus 指标端点。
- **安全性**：服务间调用必须鉴权；所有 API 必须验证输入合法性；敏感数据必须脱敏。
- **扩展性**：工具注册、消息桥接、MCP 适配器必须模块化，支持动态加载。

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
- [ ] Agent 服务提供标准 OpenAPI 3.0 接口描述（`GET /agent/openapi.json`）
- [ ] MCP 工具注册表存在，真实工具调用经过 Registry + Policy + Adapter 三层
- [ ] 消息队列适配器存在，支持 CloudEvents 标准事件收发
- [ ] 支持管理员直接指令执行，Agent 仅调用工具，不执行写操作
- [ ] 指令记录含 `manager_decision` 字段，状态流转正确
