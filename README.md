# CampusOverflow AI

面向高校课程场景的智能问答平台：校园问答、课程社区、声誉激励、内容治理，以及一个受控的 TypeScript Agent Runtime（第二阶段实施），为平台提供站内检索、智能标签、相似问题推荐、辅助回答、审核预警、持久化记忆、MCP 工具接入和文档草稿生成能力。

> **当前阶段说明**（spec v3，2026-09-20）：本期只做业务后端——FastAPI + MySQL 全部核心业务与测试；Agent 服务与前端页面随第二阶段实施（`/internal/agent/*` 仅保留前缀注释与 TODO 事件钩子，治理逻辑仅建表 + 501 占位）。
> **角色模型**：RBAC 三角色 student / teacher / admin；助教不是独立角色——研究生身份且助教认证通过 → 助教能力位（`require_graduate_assistant`），解锁学生端助教板块。

## 核心定位

```text
CampusOverflow AI = 校园问答平台 + 课程知识库 + 声誉社区 + 受控 Agent Loop（第二阶段）
```

设计原则：

- 主业务由 FastAPI + MySQL 承担，保证权限、事务、数据一致性和可审计性。
- Agent 不直接连接数据库，只能通过 FastAPI 暴露的白名单业务接口获取上下文或提交建议。
- 高风险操作（删帖、封号、内容隐藏）：第一期由管理员直接执行并留审计；第二阶段起 AI 仅能创建待确认工单，由人工确认后执行。
- Agent 具备持久化记忆和可观测性，关键运行过程必须可追踪、可回放、可审计（第二阶段完整实现）。

## 业务域

平台业务划分为六个核心域：

| 业务域 | 职责 | 核心能力 |
| ------ | ---- | -------- |
| 用户与权限 | 账号体系与访问控制 | 注册、登录、角色权限、研究生助教能力位、封禁状态、个人资料 |
| 课程空间 | 以课程为单位的社区组织 | 课程列表、课程详情、课程成员、课程问答区 |
| 问答系统 | 平台核心内容流转 | 提问、回答、评论、采纳、助教推荐标记、软删除、Markdown 内容 |
| 声誉激励 | 社区贡献度量与激励 | 点赞、点踩、积分流水、徽章、排行榜 |
| 内容治理 | 风险控制与人工审核 | 风险检测、审核工单、内容快照、申诉记录（一期建表 + 占位） |
| Agent 增强 | AI 能力扩展 | 智能标签、相似问题推荐、AI 辅助回答、静默内容巡检与审核预警、教师周报、文档草稿、持久化记忆、MCP Adapter（第二阶段） |

## 模块划分

### 业务后端（FastAPI + SQLAlchemy，本期实施）

轻量模块化单体：6 个业务模块 × 3.5 层（router → service → repository(可选) → models），目录与结构以 [docs/后端架构说明.md](./docs/后端架构说明.md) 第 7 节为权威。

| 目录 | 内容 |
| ---- | ---- |
| `app/modules/identity/` | 认证、用户、角色与助教能力位（当前已实现 auth/users 模块，T-02） |
| `app/modules/courses/` | 课程、课程成员、课程问答区聚合 |
| `app/modules/qa/` | 问题、回答、评论、采纳、助教推荐标记、标签 |
| `app/modules/interaction/` | 投票、声誉流水、通知 |
| `app/modules/discovery/` | 搜索、筛选、热门与榜单 |
| `app/modules/governance/` | 审核工单、快照、申诉、审批、Agent 治理表（一期建表 + 501 占位） |
| `app/core/` | 配置、安全（JWT）、权限依赖（`require_roles` / `require_graduate_assistant`）、日志、统一错误处理 |
| `app/db/` | SQLAlchemy 会话、模型 base、Alembic 迁移 |
| `app/shared/` | 统一响应格式 `{ code, data, message }`、分页、通用 schemas |
| `app/main.py` | FastAPI 应用入口与路由注册 |
| `tests/` | pytest 测试（认证、能力位、问答、声誉、治理边界等） |

### 前端模块（Next.js App Router，第二阶段）

| 模块 | 内容 |
| ---- | ---- |
| `app/` | 文件式路由：首页、`(auth)/login`、`(auth)/register`、`courses/[id]`、`questions/[id]`、`admin/*`、`agent/*` |
| `features/` | 业务域组件：auth、courses、questions、answers、comments、tags、reputation、notifications、moderation、agent-assist |
| `shared/` | 通用组件、hooks、utils、types |
| `api/` | FastAPI 业务接口封装、Agent 服务流式请求封装（经 next.config rewrites 代理） |

### Agent 服务模块（TypeScript + Vercel AI SDK，第二阶段）

| 目录 | 内容 |
| ---- | ---- |
| `loop/` | Agent Loop：agent-loop、task-classifier、risk-policy、self-check |
| `tools/` | 工具白名单注册（`registry.ts`）+ `backend-client.ts`（调用 FastAPI 内部接口，Agent 访问数据的唯一通道） |
| `mcp/` | MCP Adapter：client、白名单 registry、风险 policy、工具 adapter |
| `memory/` | 持久化记忆：store（经 FastAPI 读写）、summarizer、selectors |
| `approvals/` | Human-in-the-loop：审批策略、待确认动作管理 |
| `observability/` | trace id 透传、结构化日志、telemetry |

## 技术栈

| 层次 | 技术选型 | 说明 |
| ---- | -------- | ---- |
| 业务后端（本期） | FastAPI + Python（≥ 3.11） | 核心 API、权限、事务处理 |
| 数据库 | MySQL | 核心数据持久化 |
| ORM | SQLAlchemy 2.x（同步 + PyMySQL） | 数据模型、关系映射、事务管理 |
| 数据迁移 | Alembic | 数据库结构版本管理 |
| 前端（第二阶段） | Next.js 16（App Router）+ React 19 + TypeScript 5 + Tailwind CSS 4 | 页面、BFF 聚合、AI UI、流式交互 |
| AI Agent（第二阶段） | TypeScript 5 + Vercel AI SDK 7 + Hono + Zod v4（Node ≥ 22，ESM） | agent loop、tool calling、流式响应、结构化输出、tool approval |
| MCP Adapter（第二阶段） | @modelcontextprotocol/sdk + 工具白名单 | 接入外部工具，但不绕过业务权限 |
| 可观测性 | trace id + 结构化日志（OpenTelemetry exporter 第二阶段接入） | 请求与 Agent 调用链追踪 |
| 部署 | Docker Compose + Nginx（一期范围：backend + MySQL） | 多服务编排、反向代理 |
| 测试 | pytest（后端，本期）+ Vitest（前端/Agent，第二阶段） | 核心流程与边界覆盖 |

## 系统架构

```text
用户浏览器
  |
  v
Next.js 前端 / BFF / AI UI（第二阶段）
  |
  | 普通业务请求
  v
FastAPI 业务后端（本期）
  |
  v
MySQL

Next.js 前端 / BFF / AI UI
  |
  | AI 增强请求
  v
TypeScript Agent Service（第二阶段）
  |
  | tool calling（仅经 /internal/agent/* 白名单接口）
  v
FastAPI 业务后端
  |
  v
MySQL
```

三端（学生端 / 教师端 / 管理员端）共用同一套后端 6 模块与同一 MySQL，端差异全部收敛在 `app/core/` 权限依赖（`require_roles` / `require_graduate_assistant`）。

## 访问入口与端口

学生端、教师端和管理员后台不拆分为多个 Web 服务，共用同一个 Next.js 前端入口，通过页面路由和 FastAPI RBAC 权限区分（前端为第二阶段；本期可经 OpenAPI 直接访问后端接口）。

| 服务 | 端口 | 说明 | 阶段 |
| ---- | ---- | ---- | ---- |
| Next.js | `3000` | 学生端、教师端、管理员后台、AI UI | 第二阶段 |
| FastAPI | `8000` | 公开业务 API、管理员 API、Agent 内部白名单 API | 本期 |
| Agent Runtime | `8787` | agent loop、tool calling、AI 流式接口 | 第二阶段 |
| MySQL | `3306` | 仅服务内访问，生产环境不暴露公网 | 本期 |
| Nginx | `80/443` | 生产统一入口 | 部署阶段 |

`/internal/agent/*` 虽然位于 FastAPI 服务中，但不暴露给普通用户访问，只允许 Agent Runtime 通过服务间 token 和内网网络调用（第二阶段启用）。

## Agent Loop（第二阶段）

Agent 采用 agent loop 而非固定 workflow：

```text
感知输入 → 判断任务类型 → 规划下一步 → 选择工具
→ 调用 FastAPI 白名单接口 → 调用模型生成结果 → 自检结果
→ 记录日志 → 返回建议或创建待确认操作
```

Agent 持续处理站内事件（新问题、新回答、新评论、审核触发词、周报生成请求等），但不是自动执行者：所有高风险动作都进入人工确认队列。

## Agent 工程能力（第二阶段目标）

| 能力 | 项目做法 |
| ---- | -------- |
| MCP 协议支持 | Agent Runtime 内实现 MCP Adapter，只接入白名单 MCP Server，所有调用经过策略检查 |
| 持久化记忆 | 通过 FastAPI 写入 MySQL 的 `agent_memories`、`agent_runs`、`tool_call_logs` 等表 |
| 单 Agent Loop | 不引入 LangGraph/CrewAI；TS + Vercel AI SDK 实现单 Agent Loop + task router，角色化扩展留作后续 |
| Observability | trace id 关联 Next.js 请求、FastAPI API、Agent run、tool call 和审批记录 |
| Human-in-the-loop | 高风险操作写入 `approval_requests`，由管理员在后台确认 |
| 流式 UI + 类型安全 | Next.js + `@ai-sdk/react` 展示流式结果，Zod 校验工具入参和模型输出 |

## 文档

- [需求文档](./docs/需求文档.md)（v3）
- [后端架构说明](./docs/后端架构说明.md)（本期权威架构文档）
- [后端架构（按端拆分）](./docs/后端架构/README.md) — 学生端 / 教师端 / 管理员端三份端接口文档 + Agent 预留文档
- [项目骨架分析](./docs/项目骨架分析.md)（前端/Agent 目录为二期参考）
- [依赖说明](./docs/依赖说明.md)
- [标准化流程（规格驱动开发）](./docs/workflow.md)
- [操作文档（Agent 协作实操手册）](./docs/操作文档.md)
- [开发协作流程文档（分支 / PR / SM 审查）](./docs/开发协作流程文档.md)
- [接口设计指南](./docs/接口设计指南.md)（接口清单基于 spec v1，以 spec/plan v3 为准）
- [specs/](./specs) — constitution / spec / plan / tasks / analyze
- [AGENTS.md](./AGENTS.md) — AI 编码代理工作指引

> 历史文档归档于 `_archive/2026-09-20-pre-v3/`（旧版设计文档、全量业务拆解、前端业务拆分、speckit-list）。

## Roadmap

实施进度以 [specs/tasks.md](./specs/tasks.md)（v2）为准。

- [x] 目录骨架（三服务全目录 + 占位，T-01）
- [x] 用户注册登录与角色权限（T-02，含管理员封禁/解禁）
- [ ] 研究生身份与助教能力位（T-02a）
- [ ] 核心问答闭环后端（T-03~T-10：课程、问题、回答与采纳+助教推荐标记、评论、标签、投票声誉、搜索、通知）
- [ ] 一期部署与自检（T-18 backend+MySQL 容器化、T-19 测试补齐、T-20 宪法自检）
- [ ] 第二阶段：Agent 服务与治理逻辑（T-11~T-17）、前端页面、完整部署
