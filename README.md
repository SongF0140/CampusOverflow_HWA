# CampusOverflow AI

面向高校课程场景的智能问答平台：校园问答、课程社区、声誉激励、内容治理，以及一个受控的 TypeScript Agent Runtime，为平台提供站内检索、智能标签、相似问题推荐、辅助回答、审核预警、持久化记忆、MCP 工具接入和文档草稿生成能力。

## 核心定位

```text
CampusOverflow AI = 校园问答平台 + 课程知识库 + 声誉社区 + 受控 Agent Loop
```

设计原则：

- 主业务由 FastAPI + MySQL 承担，保证权限、事务、数据一致性和可审计性。
- Agent 不直接连接数据库，只能通过 FastAPI 暴露的白名单业务接口获取上下文或提交建议。
- 涉及删帖、封号、文件写入、内容隐藏、外部 MCP 工具调用等高风险操作必须经过人工确认并记录日志。
- Agent 具备持久化记忆和可观测性，关键运行过程必须可追踪、可回放、可审计。

## 业务域

平台业务划分为六个核心域：

| 业务域 | 职责 | 核心能力 |
| ------ | ---- | -------- |
| 用户与权限 | 账号体系与访问控制 | 注册、登录、角色权限、封禁状态、个人资料 |
| 课程空间 | 以课程为单位的社区组织 | 课程列表、课程详情、课程成员、课程问答区 |
| 问答系统 | 平台核心内容流转 | 提问、回答、评论、采纳、软删除、Markdown 内容 |
| 声誉激励 | 社区贡献度量与激励 | 点赞、点踩、积分流水、徽章、排行榜 |
| 内容治理 | 风险控制与人工审核 | 风险检测、审核工单、内容快照、申诉记录 |
| Agent 增强 | AI 能力扩展 | 智能标签、相似问题推荐、AI 辅助回答、静默内容巡检与审核预警、教师周报、文档草稿、持久化记忆、MCP Adapter |

## 模块划分

### 前端模块（Next.js App Router + React 19 + TypeScript）

| 模块 | 内容 |
| ---- | ---- |
| `app/` | 文件式路由：首页、`(auth)/login`、`(auth)/register`、`courses/[id]`、`questions/[id]`、`admin/*`、`agent/*` |
| `features/` | 业务域组件：auth、courses、questions、answers、comments、tags、reputation、notifications、moderation、agent-assist |
| `shared/` | 通用组件、hooks、utils、types（问题卡片、编辑器、投票组件、Markdown 渲染等） |
| `api/` | FastAPI 业务接口封装、Agent 服务流式请求封装（经 next.config rewrites 代理：`/api/backend/*` → FastAPI:8000，`/api/agent/*` → Agent:8787） |
| `public/` | 静态资源 |

### 后端模块（FastAPI + SQLAlchemy）

| 目录 | 内容 |
| ---- | ---- |
| `app/modules/` | 按领域分包的 16 个业务模块：auth、users、courses、questions、answers、comments、tags、votes、reputation、search、notifications、moderation、agent_memory、approvals、observability、agent_gateway；每模块统一结构 `models.py / schemas.py / service.py / router.py`（可选 `repository.py`、`events.py`） |
| `app/core/` | 配置、安全（JWT）、权限、日志、统一错误处理 |
| `app/db/` | SQLAlchemy 会话、模型 base、Alembic 迁移（`db/migrations/`） |
| `app/shared/` | 统一响应格式 `{ code, data, message }`、分页、通用 schemas |
| `app/main.py` | FastAPI 应用入口与路由注册 |
| `tests/` | pytest 测试（auth、questions、reputation、moderation 等） |

> 关键模块说明：`agent_gateway` 提供 Agent 专用白名单接口（上下文读取、建议提交、待确认操作创建，路径 `/internal/agent/*`）；`approvals` 承载 Human-in-the-loop 审批；`observability` 关联 trace id、Agent run 与 tool call。

### Agent 服务模块（TypeScript + Vercel AI SDK）

| 目录 | 内容 |
| ---- | ---- |
| `loop/` | Agent Loop：agent-loop、task-classifier、risk-policy、self-check |
| `agents/` | 第二阶段角色化扩展点；第一阶段不实现真实多 Agent |
| `tools/` | 工具白名单注册（`registry.ts`）+ `backend-client.ts`（调用 FastAPI 内部接口，Agent 访问数据的唯一通道）+ 各工具实现 |
| `tasks/` | 任务级实现：suggest-tags、similar-questions、answer-assist、moderation-scan、weekly-summary、doc-draft |
| `prompts/` | 各任务的系统提示词模板 |
| `routes/` | Hono 路由：任务入口、`/agent/runs` |
| `mcp/` | MCP Adapter：client、白名单 registry、风险 policy、工具 adapter |
| `memory/` | 持久化记忆：store（经 FastAPI 读写）、summarizer、selectors |
| `approvals/` | Human-in-the-loop：审批策略、待确认动作管理 |
| `observability/` | trace id 透传、结构化日志、telemetry |
| `types/` | task / tool / memory / approval / mcp / agent-run 类型定义 |

## 技术栈

| 层次 | 技术选型 | 说明 |
| ---- | -------- | ---- |
| 前端 | Next.js 16（App Router）+ React 19 + TypeScript 5 | 页面、BFF 聚合、AI UI、流式交互 |
| 样式 | Tailwind CSS 4 | 一致、现代的界面 |
| 业务后端 | FastAPI + Python（≥ 3.11） | 核心 API、权限、事务处理 |
| 数据库 | MySQL | 核心数据持久化 |
| ORM | SQLAlchemy 2.x（同步 + PyMySQL） | 数据模型、关系映射、事务管理 |
| 数据迁移 | Alembic | 数据库结构版本管理 |
| AI Agent | TypeScript 5 + Vercel AI SDK 7 + Hono + Zod v4（Node ≥ 22，ESM） | ToolLoopAgent、tool calling、流式响应、结构化输出、tool approval |
| MCP Adapter | @modelcontextprotocol/sdk + 工具白名单 | 接入外部工具，但不绕过业务权限 |
| 可观测性 | trace id + 结构化日志（第一阶段） | OpenTelemetry exporter 第二阶段接入 |
| 可选中间件 | Redis（可选依赖组） | AI 限流、缓存、排行榜；第一阶段用内存实现替代 |
| 部署 | Docker Compose + Nginx | 多服务编排、反向代理 |
| 测试 | pytest（后端）+ Vitest（前端/Agent） | 端到端 Playwright 为可选扩展 |

## 系统架构

```text
用户浏览器
  |
  v
Next.js 前端 / BFF / AI UI
  |
  | 普通业务请求
  v
FastAPI 业务后端
  |
  v
MySQL / Redis

Next.js 前端 / BFF / AI UI
  |
  | AI 增强请求
  v
TypeScript Agent Service
  |
  | tool calling
  v
FastAPI 白名单业务接口
  |
  v
MySQL / Redis
```

## 访问入口与端口

学生端、教师端和管理员后台不拆分为多个 Web 服务，也不单独开多个 Python Web 端口。它们共用同一个 Next.js 前端入口，通过页面路由和 FastAPI RBAC 权限区分。

| 访问对象 | 页面路径 | 后端接口 | 权限控制 |
| -------- | -------- | -------- | -------- |
| 学生端 | `/courses`、`/questions`、`/users/me` | `/api/courses/*`、`/api/questions/*`、`/api/users/*` | student / assistant / teacher / admin |
| 教师端 | `/courses/[id]/manage`、`/reports` | `/api/courses/*`、`/api/reputation/*`、`/api/notifications/*` | teacher / admin |
| 管理员后台 | `/admin/*` | `/api/admin/*` | admin |
| Agent 面板 | `/agent/*` | `/agent/*`、`/api/admin/agent-runs/*` | teacher / admin，部分能力仅 admin |

开发环境端口建议：

| 服务 | 端口 | 说明 |
| ---- | ---- | ---- |
| Next.js | `3000` | 学生端、教师端、管理员后台、AI UI |
| FastAPI | `8000` | 公开业务 API、管理员 API、Agent 内部白名单 API |
| Agent Runtime | `8787` | agent loop、tool calling、AI 流式接口 |
| MySQL | `3306` | 仅服务内访问，生产环境不暴露公网 |
| Redis | `6379` | 可选，仅服务内访问 |
| Nginx | `80/443` | 生产统一入口 |

生产环境建议由 Nginx 统一入口：

```text
/              -> Next.js:3000
/api/          -> FastAPI:8000
/agent/        -> Agent Runtime:8787
/docs/api      -> FastAPI OpenAPI
```

`/internal/agent/*` 虽然位于 FastAPI 服务中，但不应暴露给普通用户访问，只允许 Agent Runtime 通过服务间 token 和内网网络调用。

## Agent Loop

Agent 采用 agent loop 而非固定 workflow：

```text
感知输入
→ 判断任务类型
→ 规划下一步
→ 选择工具
→ 调用 FastAPI 白名单接口
→ 调用模型生成结果
→ 自检结果
→ 记录日志
→ 返回建议或创建待确认操作
```

Agent 持续处理站内事件（新问题、新回答、新评论、审核触发词、周报生成请求等），但不是自动执行者：所有高风险动作都进入人工确认队列。

## Agent 工程能力

为了让项目具备求职展示价值，Agent Runtime 不停留在单次 LLM 调用，而实现以下工程能力：

| 能力 | 项目做法 |
| ---- | -------- |
| MCP 协议支持 | 在 Agent Runtime 内实现 MCP Adapter，只接入白名单 MCP Server，所有调用经过策略检查 |
| 持久化记忆 | 通过 FastAPI 写入 MySQL 的 `agent_memories`、`agent_runs`、`tool_call_logs` 等表 |
| 单 Agent Loop | 不引入 LangGraph/CrewAI；第一阶段使用 TS + Vercel AI SDK 实现单 Agent Loop + task router，第二阶段再扩展角色化 Agent |
| Observability | 使用 trace id 关联 Next.js 请求、FastAPI API、Agent run、tool call 和审批记录 |
| Human-in-the-loop | 高风险操作写入 `approval_requests`，由管理员在后台确认 |
| 流式 UI + 类型安全 | Next.js + `@ai-sdk/react` 展示流式结果，Zod 校验工具入参和模型输出 |

## 文档

- [需求文档](./docs/需求文档.md)
- [设计文档](./docs/设计文档.md)
- [项目骨架分析](./docs/项目骨架分析.md)
- [依赖说明](./docs/依赖说明.md)
- [标准化流程（规格驱动开发）](./docs/workflow.md)
- [specs/](./specs) — constitution / spec / plan / tasks / analyze
- [AGENTS.md](./AGENTS.md) — AI 编码代理工作指引

## Roadmap

设计与规划类工作已随规格链完成，实施进度以 [specs/tasks.md](./specs/tasks.md) 为准（当前：T-01 三服务骨架与工具链已完成）。

- [x] 目录骨架（三服务全目录 + 占位）
- [x] API 草案（[项目骨架分析](./docs/项目骨架分析.md) 第 9 节 + [plan.md](./specs/plan.md)）
- [x] Agent 工具白名单（`agent/src/tools/registry.ts`）
- [x] 前端页面清单（[项目骨架分析](./docs/项目骨架分析.md) 第 3 节）
- [x] Sprint 任务拆分（[tasks.md](./specs/tasks.md) T-01~T-20）
- [ ] 数据库表结构定稿（T-02/T-03 实施时由 Alembic 迁移落定）
- [ ] 业务模块实现（Phase 2~3：T-02~T-17）
- [ ] Docker Compose 部署方案（T-18）
