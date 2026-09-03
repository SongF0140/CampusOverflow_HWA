# 技术方案（Plan）

> 状态：v2（2026-09-03，覆盖 spec.md v1；第一阶段采用单 Agent Loop + task router）
> 命令：`/speckit.plan`
> 铁律：方案必须能完整覆盖 spec.md 的核心需求，逐条映射。
> 本文件是 spec 的 HOW 层：技术选型、数据模型、接口草案、目录设计。

## 1. 需求覆盖映射

> 对应 spec.md v1（US-01~US-19）；US-19 为第二阶段。

| spec 需求 | 本方案覆盖模块 | 状态 |
| --------- | -------------- | ---- |
| US-01~02 游客浏览 / 注册登录 | frontend: auth 域 + questions 公开页；backend: users 模块（JWT + bcrypt） | 已覆盖 |
| US-03~05 提问 / 回答 / 评论 | frontend: questions 域；backend: questions / answers / comments 模块 | 已覆盖 |
| US-06~08 采纳 / 投票 / 声誉 | backend: answers（采纳）+ votes / reputation 模块（积分流水） | 已覆盖 |
| US-09 搜索筛选 | backend: search 模块；frontend: questions 列表筛选 | 已覆盖 |
| US-10 课程与课程问答区 | frontend: courses 域；backend: courses 模块 | 已覆盖 |
| US-11~12 标签 / 相似问题推荐 | agent: 单 Agent Loop + task handler + tools；backend: /internal/agent/* 检索接口 | 已覆盖 |
| US-13~14 风险预警 / 工单处理 | agent: 单 Agent Loop 的 moderation task handler + approvals；backend: approvals / moderation 模块 | 已覆盖 |
| US-15 通知 | backend: notifications 模块；frontend: 通知中心 | 已覆盖 |
| US-16 封禁与申诉 | backend: users（封禁）+ appeals；frontend: admin 域 | 已覆盖 |
| US-17 持久化记忆 | backend: agent_memory 模块；agent: src/memory/（经内部接口读写） | 已覆盖 |
| US-18 运行可追踪 | agent: src/observability/；backend: observability 模块 | 已覆盖 |
| US-19 MCP 白名单（P2） | agent: src/mcp/；backend: mcp_servers 配置表 | 待第二阶段 |

## 2. 技术选型

| 层次 | 选型 | 理由 | 约束符合性（对照宪法） |
| ---- | ---- | ---- | ---------------------- |
| 前端 | Next.js 16（App Router）+ React 19 + TypeScript 5 + Tailwind CSS 4 + @ai-sdk/react | App Router 文件路由 + BFF；useChat 消费 Agent 流式输出 | C-01/C-02/C-04 |
| 业务后端 | FastAPI + SQLAlchemy 2.x（同步 + PyMySQL）+ Alembic + Pydantic + PyJWT + bcrypt | 同步模式简单可靠；Python ≥ 3.11 | C-02/C-05 |
| Agent 服务 | TypeScript 5 + Vercel AI SDK + Hono + Zod + @modelcontextprotocol/sdk | 支持 agent loop、tool calling、streaming、structured output、MCP Adapter；Node ≥ 22 且 ESM | C-05/C-06/C-07/C-08 |
| 状态管理 | 组件内 state + fetch hooks + Zustand（必要时） | 简单状态不上全局 store | C-02 |
| 数据存储 | MySQL（唯一持久层）+ Redis（可选依赖组，第一阶段不装） | Agent 记忆/审批工单/观测数据统一入库 | C-05/C-07 |
| 测试 | pytest（后端）、vitest（前端/Agent） | 与工具链原生集成 | C-03 |

依赖明细与版本约束见 [docs/依赖说明.md](../docs/依赖说明.md)。

## 3. 架构设计

三服务物理分离，Agent 不直连数据库，所有数据访问走 FastAPI 白名单接口。第一阶段采用单 Agent Loop + task router，不实现真实多 Agent 协作；`agent/src/agents/` 仅保留为第二阶段角色化扩展点。

```mermaid
graph TD
    FE[前端 Next.js<br/>src/app + src/features] -->|/api/agent 流式| AG[Agent 服务 Hono<br/>Agent Loop + MCP Adapter]
    FE -->|/api/backend BFF| BE[业务后端 FastAPI<br/>modules/{models,schemas,service,router}]
    AG -->|/internal/agent/* 白名单| BE
    AG -.->|MCP 白名单工具| MCP[MCP Server]
    BE --> DB[(MySQL)]
```

- Agent 的 run / tool call / approval 记录 trace id、agent_run_id 与调用摘要（C-08）。
- 高风险动作由 Agent 生成待确认工单，人工确认后由后端执行（C-06/C-07 配套）。
- MCP Adapter 第一阶段只接 mock MCP 工具，验证白名单、策略、日志和审批链路；真实外部 MCP Server 放第二阶段。
- Observability 第一阶段先实现 trace id 字段透传和数据库日志；完整 OTLP exporter 放第二阶段。

## 4. 数据模型

完整字段见 docs/设计文档.md 第 6 节；本节保留关键实体关系，作为实现入口。

```typescript
interface Question {
  id: string;
  courseId: string;
  authorId: string;
  title: string;
  body: string; // Markdown，渲染前需 XSS 清洗
  status: "open" | "resolved" | "closed" | "hidden" | "deleted";
  acceptedAnswerId: string | null;
  createdAt: Date;
}

interface AgentRun {
  id: string;
  taskType: "suggest_tags" | "similar_questions" | "moderation_scan" | "doc_draft";
  status: "running" | "succeeded" | "failed" | "needs_approval";
  traceId: string;
  inputSummary: string;
  outputSummary: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

interface ApprovalRequest {
  id: string;
  agentRunId: string;
  actionType: "hide_content" | "delete_content" | "ban_user" | "write_file" | "call_mcp_tool";
  riskLevel: "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "rejected" | "expired";
  reason: string;
  createdAt: Date;
}
```

后端新增模块（对应 docs/项目骨架分析.md 第 6 节）：`agent_memory`（持久化记忆）、`approvals`（审批工单）、`observability`（trace/运行日志）。

## 5. 接口/内部 API 草案

| 名称 | 签名 | 说明 | 对应 spec |
| ---- | ---- | ---- | --------- |
| GET /internal/agent/memory | (userId, taskType, courseId?) => MemoryItem[] | Agent 读取相关记忆，后端按用户、课程、任务类型做权限过滤 | US-17 / C-07 |
| POST /internal/agent/memory | (userId, memoryType, content, sourceRunId) => MemoryItem | 写入记忆，后端做敏感信息过滤与审计记录 | US-17 / C-07 / X-06 |
| POST /internal/agent/approvals | (actionType, riskLevel, payloadSnapshot, traceId) => ApprovalRequest | 高风险动作生成待确认工单，不直接执行删帖/封禁/写文件 | US-13 / US-14 / US-16 / C-06 |
| GET /internal/agent/courses/search | (keyword, limit) => Course[] | 站内课程检索工具，用于回答课程上下文相关问题 | US-10 / US-12 |
| GET /internal/agent/questions/search | (keyword, courseId?, tags?, limit) => Question[] | 相似问题候选检索，Agent 只负责排序、解释与结构化建议 | US-09 / US-12 |
| POST /internal/agent/runs | (taskType, traceId, inputSummary) => AgentRun | 创建 Agent 运行记录 | US-18 / C-08 |
| PATCH /internal/agent/runs/{id} | (status, outputSummary?, errorSummary?) => AgentRun | 更新 Agent 运行结果，便于管理员追踪失败原因 | US-18 / C-08 |
| POST /internal/agent/tool-calls | (agentRunId, toolName, argsSummary, resultSummary, status) => ToolCallLog | 记录工具调用摘要，不落原始密钥和隐私原文 | US-18 / C-08 |

完整路径规划见 docs/项目骨架分析.md 第 9 节。

## 6. 存储策略

- 全部持久化数据统一存 MySQL；Agent 无独立数据库，通过内部接口读写（C-05/C-07）。
- SQLAlchemy 同步模式 + PyMySQL；结构变更一律走 Alembic 迁移，不手改表。
- 切换 async SQLAlchemy（asyncmy/aiomysql）属于后续决策，需先回改本文档。
- AgentMemory：按 `user_id + memory_type + course_id? + source_run_id` 存储，正文写入前做敏感信息过滤；用户可删除或禁用影响自己的记忆。
- ApprovalRequest：保存风险等级、动作类型、目标对象、快照摘要、原因、状态与处理人；真正的隐藏、删除、封禁由 FastAPI 审批接口执行。
- ToolCallLog：只保存工具名、参数摘要、结果摘要、耗时、状态、trace id；禁止保存 API Key、Cookie、密码、完整隐私原文。
- MCP Server 配置为第二阶段表结构，第一阶段可只保留 mock 配置与策略测试数据。

## 7. 目录结构设计

以 [docs/项目骨架分析.md](../docs/项目骨架分析.md) 为准。Agent 侧关键目录：

```text
agent/src/
├── tools/registry.ts      # Agent 工具白名单注册
├── loop/                  # 第一阶段 Agent Loop 主循环、停止条件、自检逻辑
├── tasks/                 # 任务路由：标签推荐、相似问题、风险预警、问答检索
├── agents/                # 第二阶段角色化扩展点；第一阶段不实现多 Agent 协作
├── mcp/                   # MCP Adapter：client / registry / policy / adapter
├── memory/                # 记忆读写（经 FastAPI）、摘要、选择
├── approvals/             # 高风险动作审批策略
└── observability/         # trace id、运行日志
```

## 8. 风险与技术难点

| 编号 | 描述 | 应对 |
| ---- | ---- | ---- |
| T-01 | AI SDK 7 强制 Node ≥ 22 且 ESM，@modelcontextprotocol/sdk 协议版本需匹配 | package.json 锁 engines；升级跑官方 codemod |
| T-02 | MCP 工具可能被模型用于绕过业务权限 | 仅白名单注册；policy.ts 风险分级 + 审批工单 |
| T-03 | 记忆泄露隐私原文 | 后端写入前过滤校验；定期审计 memory 内容 |
| T-04 | 流式响应在 BFF 转发时断流/缓冲 | Route Handlers 透传 SSE，不缓冲 |
| T-05 | 过早实现多 Agent 导致展示重点发散、工期失控 | 第一阶段坚持单 Agent Loop + task router；多 Agent 只作为 `agent/src/agents/` 扩展点 |
| T-06 | 完整 OpenTelemetry/OTLP 链路对课程项目过重 | 第一阶段实现 trace id 透传 + MySQL 日志；第二阶段再接 OTLP exporter |
