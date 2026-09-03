# CampusOverflow AI

面向高校课程场景的智能问答平台：校园问答、课程社区、声誉激励、内容治理，以及一个受控的 TypeScript Agent 服务，为平台提供站内检索、智能标签、相似问题推荐、辅助回答、审核预警和文档草稿生成能力。

## 核心定位

```text
CampusOverflow AI = 校园问答平台 + 课程知识库 + 声誉社区 + 受控 Agent Loop
```

设计原则：

- 主业务由 FastAPI + MySQL 承担，保证权限、事务、数据一致性和可审计性。
- Agent 不直接连接数据库，只能通过 FastAPI 暴露的白名单业务接口获取上下文或提交建议。
- 涉及删帖、封号、文件写入、内容隐藏等高风险操作必须经过人工确认并记录日志。

## 业务域

平台业务划分为六个核心域：

| 业务域 | 职责 | 核心能力 |
| ------ | ---- | -------- |
| 用户与权限 | 账号体系与访问控制 | 注册、登录、角色权限、封禁状态、个人资料 |
| 课程空间 | 以课程为单位的社区组织 | 课程列表、课程详情、课程成员、课程问答区 |
| 问答系统 | 平台核心内容流转 | 提问、回答、评论、采纳、软删除、Markdown 内容 |
| 声誉激励 | 社区贡献度量与激励 | 点赞、点踩、积分流水、徽章、排行榜 |
| 内容治理 | 风险控制与人工审核 | 风险检测、审核工单、内容快照、申诉记录 |
| Agent 增强 | AI 能力扩展 | 智能标签、相似问题推荐、AI 辅助回答、教师周报、文档草稿 |

## 模块划分

### 前端模块（Next.js App Router + React 19 + TypeScript）

| 模块 | 内容 |
| ---- | ---- |
| `app/` | 文件式路由：首页、`(auth)/login`、`(auth)/register`、`courses/[id]`、`questions/[id]`、`admin/*`、`agent/*` |
| `features/` | 业务域组件：auth、courses、questions、answers、comments、tags、reputation、notifications、moderation、agent-assist |
| `shared/` | 通用组件、hooks、utils、types（问题卡片、编辑器、投票组件、Markdown 渲染等） |
| `api/` | FastAPI 业务接口封装、Agent 服务流式请求封装（经 next.config rewrites 代理） |
| `public/` | 静态资源 |

### 后端模块（FastAPI + SQLAlchemy）

| 模块 | 内容 |
| ---- | ---- |
| `api/` | REST 路由：users、courses、questions、answers、comments、tags、votes、notifications、moderation、agent-proxy |
| `models/` | ORM 模型：User、Course、Question、Answer、Comment、Tag、Vote、Notification、AuditTicket |
| `schemas/` | Pydantic 请求/响应模型 |
| `services/` | 业务逻辑：权限校验、声誉计算、软删除、内容快照、风险检测 |
| `agent_whitelist/` | Agent 专用白名单接口：上下文读取、建议提交、待确认操作创建 |
| `core/` | 配置、数据库连接、依赖注入、JWT 鉴权、日志 |
| `migrations/` | Alembic 数据库迁移脚本 |

### Agent 服务模块（TypeScript + Vercel AI SDK）

| 模块 | 内容 |
| ---- | ---- |
| `loop/` | Agent Loop 主循环：感知 → 规划 → 工具选择 → 生成 → 自检 |
| `tools/` | 工具注册与白名单调用：searchQuestions、similarQuestions、autoTag、draftAnswer、weeklyReport、moderationAlert |
| `prompts/` | 各任务的系统提示词模板 |
| `events/` | 站内事件消费：新问题、新回答、新评论、审核触发词 |
| `guard/` | 高风险操作拦截：生成待确认工单，禁止直接执行 |
| `clients/` | FastAPI 白名单接口客户端（Agent 访问数据库的唯一通道） |

## 技术栈

| 层次 | 技术选型 | 说明 |
| ---- | -------- | ---- |
| 前端 | Next.js + React 19 + TypeScript | 页面、BFF 聚合、AI UI、流式交互 |
| 样式 | Tailwind CSS | 一致、现代的界面 |
| 业务后端 | FastAPI + Python | 核心 API、权限、事务处理 |
| 数据库 | MySQL | 核心数据持久化 |
| ORM | SQLAlchemy 2.x | 数据模型、关系映射、事务管理 |
| 数据迁移 | Alembic | 数据库结构版本管理 |
| AI Agent | TypeScript + Vercel AI SDK | agent loop、tool calling、流式响应、结构化输出 |
| 可选中间件 | Redis | AI 限流、缓存、排行榜、任务状态 |
| 部署 | Docker Compose + Nginx | 多服务编排、反向代理 |
| 测试 | pytest + Vitest + Playwright | 接口、逻辑、端到端测试 |

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

## 文档

- [需求文档](./docs/需求文档.md)
- [设计文档](./docs/设计文档.md)
- [项目骨架分析](./docs/项目骨架分析.md)
- [依赖说明](./docs/依赖说明.md)
- [标准化流程（规格驱动开发）](./docs/workflow.md)
- [specs/](./specs) — constitution / spec / plan / tasks / analyze
- [AGENTS.md](./AGENTS.md) — AI 编码代理工作指引

## Roadmap

- [ ] 数据库表结构定稿
- [ ] API 草案
- [ ] Agent 工具白名单
- [ ] 前端页面清单
- [ ] Docker 部署方案
- [ ] Sprint 任务拆分
