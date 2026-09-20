# 项目上下文（Project Context）

## 项目概述

CampusOverflow AI：面向高校课程场景的智能问答平台。三个服务物理分离，代码统一放在 `campus-overflow-ai/` 总目录下；文档（docs/）、规格（specs/）与规则（.trae/rules/）在根目录。

> **范围说明**（spec v3 / Q-08，2026-09-20）：本期只做业务后端；Agent 服务不搭建（`/internal/agent/*` 仅保留前缀注释与 TODO 事件钩子），治理逻辑仅建表 + 501 占位；前端页面随第二阶段实施。
> **角色模型**：RBAC 三角色 student / teacher / admin；助教不是独立角色——研究生身份且助教认证通过 → 助教能力位（`require_graduate_assistant`），解锁学生端助教板块（US-20）。

## 技术栈版本

- 业务后端（本期）：FastAPI + SQLAlchemy 2.x（同步模式 + PyMySQL）+ Alembic + MySQL（Python ≥ 3.11）
- 前端（第二阶段）：Next.js 16（App Router）+ React 19 + TypeScript 5 + Tailwind CSS 4（含 @ai-sdk/react 用于 Agent 流式 UI）
- Agent 服务（第二阶段）：TypeScript 5 + Vercel AI SDK + Hono + Zod v4 + MCP Adapter（@modelcontextprotocol/sdk），要求 Node.js ≥ 22 且 ESM
- 可选中间件：Redis（限流、缓存、排行榜，为可选依赖组，非第一阶段必需）
- 测试：pytest（后端，本期）、vitest（前端/Agent，第二阶段）

## 重要约定

- 状态管理：简单状态用组件内部 state，服务端数据封装 fetch hooks，必要时用 Zustand
- 本期只做业务后端（T-02a 与 T-03~T-10 后端部分）；Agent 服务与治理逻辑、前端页面为第二阶段
- Agent 不直接连 MySQL，只调用 FastAPI 的 `/internal/agent/*` 白名单接口（第二阶段生效；本期内部接口仅占位）
- Agent 服务届时第一阶段只做单 Agent Loop + task router，不实现真实多 Agent 协作；`agent/src/agents/` 仅作为角色化扩展点
- 高风险操作（删帖、封号、内容隐藏）：第一期由管理员直接执行并写审计日志；第二阶段起 AI 相关高风险动作只能生成待确认工单，由人工执行
- MCP Server 与工具必须白名单注册（`agent/src/mcp/registry.ts`），所有 MCP 调用经过风险策略与审批策略，不得绕过 FastAPI 直接修改核心业务数据（第二阶段）
- Agent 持久化记忆由 FastAPI 写入 MySQL（governance/agent_memory 表），Agent 仅通过内部接口读写；记忆不得含密码、密钥、隐私原文（第二阶段；本期仅保证表结构预留）
- Agent run / tool call / approval request 必须记录 trace id、agent_run_id 和调用摘要（第二阶段；本期仅保证表结构预留）
- 后端采用轻量模块化单体，6 个业务模块：identity / courses / qa / interaction / discovery / governance，每模块 `app/modules/<模块>/{models,schemas,service,router}.py`（3.5 层，repository 可选）
- 路由使用 App Router 文件约定（`src/app/**`）；页面默认 Server Components，需要交互/浏览器 API 时才加 `"use client"`；BFF 转发只放 `src/app/api`，不放核心业务（第二阶段）
- 前端按业务域组织：`src/features/<域>/`；Agent 工具统一注册在 `agent/src/tools/registry.ts`，MCP Adapter 在 `agent/src/mcp/`，记忆在 `agent/src/memory/`，审批策略在 `agent/src/approvals/`，观测在 `agent/src/observability/`（第二阶段）

## API 约定

- RESTful 风格；本期路径与范围以 docs/后端架构说明.md 为权威（前端/Agent 相关路径规划保留 docs/项目骨架分析.md 第 9 节为二期参考）
- 统一响应格式：`{ code: number, data: T, message: string }`
- 错误码：200 成功，400 参数错误，401 未授权，403 禁止，404 不存在，500 服务器错误
