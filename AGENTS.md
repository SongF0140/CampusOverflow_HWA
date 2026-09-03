# AGENTS.md

本文件为 AI 编码代理（Trae / Claude Code / Codex 等）提供项目工作指引。

## 项目概述

CampusOverflow AI：面向高校课程场景的智能问答平台。三个服务物理分离：

| 服务 | 目录 | 技术 |
| ---- | ---- | ---- |
| 前端 | `campus-overflow-ai/frontend/` | Next.js 16（App Router）+ React 19 + TypeScript 5 + Tailwind CSS 4 + @ai-sdk/react（Agent 流式 UI） |
| 业务后端 | `campus-overflow-ai/backend/` | FastAPI + SQLAlchemy 2.x（同步 + PyMySQL）+ Alembic + MySQL（Python ≥ 3.11） |
| Agent 服务 | `campus-overflow-ai/agent/` | TypeScript 5 + Vercel AI SDK 7 + Hono + Zod v4 + MCP Adapter（Node ≥ 22，ESM） |

文档与规格在根目录：`docs/`（需求、设计、流程）、`specs/`（constitution/spec/plan/tasks/analyze）、`.trae/rules/`（工程规则）。

## 工作流程（规格驱动，必须遵守）

执行路径：`constitution → specify → clarify → plan → tasks → analyze → implement`，详见 [docs/workflow.md](./docs/workflow.md)。

- **spec.md 只写需求（WHAT）**，禁止写入技术实现细节；实现方案只能进 plan.md。
- **宪法（constitution.md）优先级最高**，与任何文档或代码冲突时以宪法为准。
- **修改 spec / plan / tasks 后，进入 implement 前必须重跑一致性分析**（specs/analyze.md）。
- **tasks.md 严格按 Phase 顺序执行**，每完成一项打勾；失败时回改上游文档，不跳过。

## 硬性约束（违反即返工）

1. **Agent 服务不直接连接 MySQL**，只能调用 FastAPI 的 `/internal/agent/*` 白名单接口。
2. **高风险操作**（删帖、封号、文件写入、内容隐藏）只能由 Agent 创建"待确认工单"，由人工确认后执行。
3. **MCP 工具必须白名单注册**，不得绕过 FastAPI 直接修改核心业务数据。
4. **Agent 记忆必须持久化且可审计**，不得把密码、密钥、隐私原文写入 memory。
5. **Agent run / tool call / approval request 必须可追踪**，至少保留 trace id、agent_run_id 和调用摘要。
6. 界面文案使用简体中文。
7. 规则必须是可检查的：代码需通过 `ruff check`（后端）、`eslint`（前端/Agent）零 error。
8. 核心流程必须有测试：后端 pytest、前端与 Agent vitest。

## 常用命令

> 各依赖包的用途与版本约束见 [docs/依赖说明.md](./docs/依赖说明.md)。

```bash
# 后端（campus-overflow-ai/backend/，uv 环境）
uv venv                          # 首次：创建 .venv
uv pip install -e ".[dev]"       # 安装依赖
uv run pytest                    # 测试
uv run ruff check .              # Lint
uv run uvicorn app.main:app --reload    # 启动开发服务器

# 前端（campus-overflow-ai/frontend/）
npm install && npm run dev       # 启动开发服务器
npm test                         # 测试
npm run lint                     # Lint

# Agent 服务（campus-overflow-ai/agent/）
npm install && npm run dev       # 启动开发服务器
npm test                         # 测试
npm run lint                     # Lint
```

## 目录约定

- 后端业务按模块组织在 `backend/app/modules/`，每个模块统一结构：`models.py / schemas.py / service.py / router.py`（详见 [docs/项目骨架分析.md](./docs/项目骨架分析.md) 第 4.1 节）。
- 前端采用 Next.js App Router，页面放在 `frontend/src/app/`，业务组件和状态逻辑按领域组织在 `frontend/src/features/`。
- Agent 的工具注册在 `agent/src/tools/registry.ts`，仅注册白名单工具。
- MCP Adapter 放在 `agent/src/mcp/`，持久化记忆放在 `agent/src/memory/`，审批策略放在 `agent/src/approvals/`，观测能力放在 `agent/src/observability/`。
- 完整目录结构以 [docs/项目骨架分析.md](./docs/项目骨架分析.md) 为准，新增目录需先更新该文档。

## 代码风格

遵循 [.trae/rules/coding-style.md](./.trae/rules/coding-style.md) 与 [.trae/rules/conventions.md](./.trae/rules/conventions.md)：小驼峰命名、函数不超过 80 行、禁止空 catch、注释用简体中文、只对非自明逻辑注释。
