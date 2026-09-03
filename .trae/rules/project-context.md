# 项目上下文（Project Context）

## 项目概述

CampusOverflow AI：面向高校课程场景的智能问答平台。三个服务物理分离，代码统一放在 `campus-overflow-ai/` 总目录下；文档（docs/）、规格（specs/）与规则（.trae/rules/）在根目录。

## 技术栈版本

- 前端：Next.js 16（App Router）+ React 19 + TypeScript 5 + Tailwind CSS 4（含 @ai-sdk/react 用于 Agent 流式 UI）
- 业务后端：FastAPI + SQLAlchemy 2.x（同步模式 + PyMySQL）+ Alembic + MySQL（Python ≥ 3.11）
- Agent 服务：TypeScript 5 + Vercel AI SDK + Hono + Zod v4 + MCP Adapter（@modelcontextprotocol/sdk），要求 Node.js ≥ 22 且 ESM
- 可选中间件：Redis（限流、缓存、排行榜，为可选依赖组，非第一阶段必需）
- 测试：pytest（后端）、vitest（前端/Agent）

## 重要约定

- 状态管理：简单状态用组件内部 state，服务端数据封装 fetch hooks，必要时用 Zustand
- Agent 不直接连 MySQL，只调用 FastAPI 的 `/internal/agent/*` 白名单接口
- 第一阶段只做单 Agent Loop + task router，不实现真实多 Agent 协作；`agent/src/agents/` 仅作为第二阶段角色化扩展点
- 高风险操作（删帖、封号、内容隐藏、文件写入）只生成待确认工单，由人工执行
- MCP Server 与工具必须白名单注册（`agent/src/mcp/registry.ts`），所有 MCP 调用经过风险策略与审批策略，不得绕过 FastAPI 直接修改核心业务数据
- Agent 持久化记忆由 FastAPI 写入 MySQL（agent_memory 模块），Agent 仅通过内部接口读写；记忆不得含密码、密钥、隐私原文
- Agent run / tool call / approval request 必须记录 trace id、agent_run_id 和调用摘要（`agent/src/observability/`）
- 后端按业务模块组织：`app/modules/<模块>/{models,schemas,service,router}.py`
- 路由使用 App Router 文件约定（`src/app/**`）；页面默认 Server Components，需要交互/浏览器 API 时才加 `"use client"`；BFF 转发只放 `src/app/api`，不放核心业务
- 前端按业务域组织：`src/features/<域>/`；Agent 工具统一注册在 `agent/src/tools/registry.ts`，MCP Adapter 在 `agent/src/mcp/`，记忆在 `agent/src/memory/`，审批策略在 `agent/src/approvals/`，观测在 `agent/src/observability/`

## API 约定

- RESTful 风格，路径规划见 docs/项目骨架分析.md 第 9 节
- 统一响应格式：`{ code: number, data: T, message: string }`
- 错误码：200 成功，400 参数错误，401 未授权，403 禁止，404 不存在，500 服务器错误
