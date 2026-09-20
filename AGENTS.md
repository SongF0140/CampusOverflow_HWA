# AGENTS.md

本文件为 AI 编码代理（Trae / Claude Code / Codex 等）提供项目工作指引。

## 项目概述

CampusOverflow AI：面向高校课程场景的智能问答平台。三个服务物理分离：

| 服务 | 目录 | 技术 | 阶段 |
| ---- | ---- | ---- | ---- |
| 业务后端 | `campus-overflow-ai/backend/` | FastAPI + SQLAlchemy 2.x（同步 + PyMySQL）+ Alembic + MySQL（Python ≥ 3.11） | **本期实施** |
| 前端 | `campus-overflow-ai/frontend/` | Next.js 16（App Router）+ React 19 + TypeScript 5 + Tailwind CSS 4 + @ai-sdk/react（Agent 流式 UI） | 第二阶段 |
| Agent 服务 | `campus-overflow-ai/agent/` | TypeScript 5 + Vercel AI SDK 7 + Hono + Zod v4 + MCP Adapter（Node ≥ 22，ESM） | 第二阶段 |

> **范围说明**（spec v3 / Q-08，2026-09-20）：本期只做业务后端；Agent 服务不搭建（`/internal/agent/*` 仅保留前缀注释与 TODO 事件钩子），治理逻辑仅建表 + 501 占位；前端页面随第二阶段实施。
> **角色模型**（spec v3）：RBAC 三角色 student / teacher / admin；助教不是独立角色——研究生身份且助教认证通过 → 助教能力位（`require_graduate_assistant`），解锁学生端助教板块（US-20）。

文档与规格在根目录：`docs/`（需求、架构、流程）、`specs/`（constitution/spec/plan/tasks/analyze）、`.trae/rules/`（工程规则）。

## 工作流程（规格驱动，必须遵守）

执行路径：`constitution → specify → clarify → plan → tasks → analyze → implement`，详见 [docs/workflow.md](./docs/workflow.md)。

- **spec.md 只写需求（WHAT）**，禁止写入技术实现细节；实现方案只能进 plan.md。
- **宪法（constitution.md）优先级最高**，与任何文档或代码冲突时以宪法为准。
- **修改 spec / plan / tasks 后，进入 implement 前必须重跑一致性分析**（specs/analyze.md）。
- **tasks.md 严格按 Phase 顺序执行**，每完成一项打勾；失败时回改上游文档，不跳过。当前执行以 tasks.md v2 的"一期实施范围总注"为准。
- **快捷命令**：`/spec <任务号>` 等价于 `/speckit.implement <任务号>`，默认上下文为 AGENTS.md、specs/、docs/（按需），收尾动作为勾选 `specs/tasks.md`；细则见 [docs/workflow.md](./docs/workflow.md) "快捷命令 /spec" 一节。

## 硬性约束（违反即返工）

1. **Agent 服务不直接连接 MySQL**，只能调用 FastAPI 的 `/internal/agent/*` 白名单接口。（第二阶段生效；本期 Agent 不搭建，内部接口仅占位）
2. **高风险操作**（删帖、封号、内容隐藏）：第一期由管理员直接执行并写入审计日志（封禁已在 T-02 实现）；第二阶段起 AI 相关高风险动作只能由 Agent 创建"待确认工单"，由人工确认后执行（C-06）。
3. **MCP 工具必须白名单注册**，不得绕过 FastAPI 直接修改核心业务数据。（第二阶段生效）
4. **Agent 记忆必须持久化且可审计**，不得把密码、密钥、隐私原文写入 memory。（第二阶段生效；本期仅保证表结构预留）
5. **Agent run / tool call / approval request 必须可追踪**，至少保留 trace id、agent_run_id 和调用摘要。（第二阶段生效；本期仅保证表结构预留）
6. 界面文案使用简体中文。（一期指后端错误消息与接口描述文案）
7. 规则必须是可检查的：代码需通过 `ruff check`（后端）、`eslint`（前端/Agent）零 error。
8. 核心流程必须有测试：后端 pytest、前端与 Agent vitest。

## 常用命令

> 各依赖包的用途与版本约束见 [docs/依赖说明.md](./docs/依赖说明.md)。前端与 Agent 命令在第二阶段使用。

```bash
# 后端（campus-overflow-ai/backend/，uv 环境）——本期
uv venv                          # 首次：创建 .venv
uv pip install -e ".[dev]"       # 安装依赖
uv run pytest                    # 测试
uv run ruff check .              # Lint
uv run uvicorn app.main:app --reload    # 启动开发服务器

# 前端（campus-overflow-ai/frontend/）——第二阶段
npm install && npm run dev       # 启动开发服务器
npm test                         # 测试
npm run lint                     # Lint

# Agent 服务（campus-overflow-ai/agent/）——第二阶段
npm install && npm run dev       # 启动开发服务器
npm test                         # 测试
npm run lint                     # Lint
```

## 目录约定

- 后端采用轻量模块化单体，6 个业务模块：identity / courses / qa / interaction / discovery / governance，每模块统一结构 `models.py / schemas.py / service.py / router.py`（3.5 层：router → service → repository(可选) → models）。
- **后端目录与结构以 [docs/后端架构说明.md](./docs/后端架构说明.md) 第 7 节为权威**；当前已实现 identity 域的 auth/users 模块（T-02）。
- 前端/Agent 目录约定为第二阶段参考：frontend 页面放 `frontend/src/app/`、业务组件按领域放 `frontend/src/features/`；agent 工具注册在 `agent/src/tools/registry.ts`，MCP Adapter 在 `agent/src/mcp/`，持久化记忆在 `agent/src/memory/`，审批策略在 `agent/src/approvals/`，观测能力在 `agent/src/observability/`（详见 docs/项目骨架分析.md）。

## 代码风格

遵循 [.trae/rules/coding-style.md](./.trae/rules/coding-style.md) 与 [.trae/rules/conventions.md](./.trae/rules/conventions.md)：小驼峰命名、函数不超过 80 行、禁止空 catch、注释用简体中文、只对非自明逻辑注释。
