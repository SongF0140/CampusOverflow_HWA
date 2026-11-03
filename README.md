# CampusOverflow AI

面向高校课程的问答与教学协作平台，提供课程社区、问答沉淀、声誉激励，以及需要人工审批的 AI 内容治理。业务后端负责身份、权限、事务与最终执行，Agent 负责分析、提出建议和编排流程。

> 状态更新：2026-11-03。自治理 Workflow 的 WF-01～WF-05 已完成代码实现及隔离环境验证，用户反馈本轮 CI/CD 成功。前端仍在补完；真实模型质量、生产灰度和多实例容量仍待验收。治理开关在代码中默认关闭，CI/CD 成功不代表线上已启用。

## 功能与进度

| 能力 | 当前状态 |
| --- | --- |
| 用户与课程 | 注册登录、RBAC、课程成员、研究生助教能力位等后端能力已实现 |
| 问答社区 | 问题、回答、评论、采纳、助教推荐、标签、投票、声誉、通知和检索已实现；页面继续补完 |
| 教学辅助 | 知识树、教学计划、周报、标签与相似问题建议等已有实现；真实模型效果仍需评估 |
| 内容治理 | 工单、申诉、冻结审批、受控执行、幂等回执和审计已有实现 |
| 自治理 Workflow | 后台巡检发起系统根任务，模型规划与效果评估，最多五轮，逐项人工审批；已做真实数据库与故障恢复验证 |
| 记忆与会话 | 学生/教师使用浏览器账号隔离存储；管理员使用服务器私有目录，按账号和来源隔离；公共知识独立管理 |
| MCP 与观测 | 白名单 MCP 服务、身份与策略控制、运行/步骤/工具/审批审计已有实现；生产监控与归档仍需收尾 |

当前任务以 [specs/tasks.md](./specs/tasks.md) 的最新增量及验收记录为准。历史阶段说明保留在记录中，不代表当前尚未实现。

## 角色与权限

- **学生端**：普通 AI 对话，不允许模型调用工具，包括只读检索工具；不允许触发自治理。正常问答和课程页面仍通过业务 API 使用。
- **教师端**：按本人课程和教学权限使用业务功能；不具有管理员自治理处置权限。
- **管理端**：具备治理查询、建议与审批能力。隐藏、删除、封禁等高风险动作须逐项审批，由后端复核当前权限和目标状态后执行。
- **后台巡检**：以独立系统身份发起管理侧治理流程，不冒用管理员登录身份；系统任务本身不能批准高风险动作。

**尚未落实的权限差异**：以上学生工具限制是 2026-11-03 用户确认的要求。当前 [默认工具规则](./campus-overflow-ai/agent/src/memory/main-context.ts) 仍给学生配置只读工具，[聊天入口](./campus-overflow-ai/agent/src/routes/chat.ts) 仍经过工具规划流程；需按 CHAT-01 收紧规则及相关入口并补越权测试。这次文档更新没有改变代码权限，不能将“学生无写操作权限”视为“学生无工具调用权限”。

助教不是第四种角色：RBAC 仍为 `student / teacher / admin`，助教资格作为学生的能力位。

## 架构与数据职责

三个服务物理分离，学生、教师和管理员共用同一个 Next.js 前端，通过页面路由和服务端权限区分。

```text
浏览器：学生端 / 教师端 / 管理端
                   │
             Next.js 页面与 BFF
                │         │
         普通业务请求     AI 请求
                │         ▼
                │   Hono / Nitro Agent
                │      │            │
                ▼      │白名单接口   └── Workflow ── 独立 PostgreSQL
              FastAPI ◄┘
                │
              MySQL

Markdown / Wiki ── 知识参考，经受控资料接口供 Agent 使用
```

| 存储 | 保存什么 | 职责边界 |
| --- | --- | --- |
| MySQL | 用户、课程、内容、权限、审批、执行回执、业务审计与发现进度 | 业务事实和最终授权以此为准，仅 FastAPI 访问业务库 |
| Markdown / Wiki | 教材资料、知识目录和可核验的参考内容 | 不承担业务授权或 Workflow 队列；不混入私人会话与记忆 |
| 独立 PostgreSQL | Workflow 运行状态、队列及必要的恢复输入/输出 | 只负责持久执行与恢复，不替代 MySQL，不保存服务凭据、模型密钥或私人聊天 |

管理员私有会话/记忆另存服务器受控目录，学生/教师的个人上下文保存在浏览器；这些不属于公共 Wiki 或 Workflow 运行库。

## 管理端自治理如何工作

```text
巡检分页发现内容 → 后端创建/复用系统根任务 → 绑定 Workflow Run
    → 读取目标与版本 → LLM 规划 → 每项动作分别申请人工审批
    → 后端复核并执行 → 读取回执 → 重新观察 → LLM 评估效果
    → 完成 / 下一轮 / 转人工
```

- 最多 **5 轮完整 loop**，按“规划、动作、重新观察、评估”计轮；一轮可有多个动作，不把每次动作当成一轮。
- 每轮最多 3 个动作；累计最多 40 个逻辑工具调用、120 秒活动时间。审批最长等待 7 天，持久等待不累计活动时间。
- 审批冻结动作、参数和目标版本。目标变化或已知未执行的可恢复错误，可反馈给下一轮模型修订，并消耗下一轮预算。
- 响应丢失先查原回执；权限失效、无法确认执行结果或预算耗尽时转人工，不能换任务重置轮数或重复执行。
- 持久发现分页、原 Run 失败收尾和重启续接已有验证。内部 Workflow 回调经仅 loopback 监听的专用代理进入，公开入口拒绝无效凭据。

模型提出判断和动作建议，Workflow 保存执行进度；业务授权、审批有效性和真实副作用始终由 FastAPI 决定。运行开关与数据库初始化见 [Agent 运行说明](./campus-overflow-ai/agent/README.md)。

## 技术栈与目录

| 服务 | 技术 | 目录 |
| --- | --- | --- |
| 业务后端 | Python ≥ 3.11、FastAPI、SQLAlchemy 2、PyMySQL、Alembic | [backend](./campus-overflow-ai/backend) |
| 前端 | Next.js 16、React 19、TypeScript、Tailwind CSS 4 | [frontend](./campus-overflow-ai/frontend) |
| Agent | Node ≥ 22.22.0、TypeScript、AI SDK 7、Hono/Nitro、Workflow、Zod 4、MCP SDK | [agent](./campus-overflow-ai/agent) |
| 部署文件 | 当前 Compose 覆盖业务后端与 MySQL；完整三服务及 Workflow 存储编排仍待补齐 | [deploy](./campus-overflow-ai/deploy) |

后端包含 `identity / courses / qa / interaction / discovery / governance` 六个模块，使用分层依赖契约检查。Agent 的 `tools/security` 管执行白名单与 hooks，`workflows` 管持久治理，`scheduler/runtime` 管后台调度与生命周期，`observability` 管运行追踪。

## 本地开发与验证

先配置目标数据库、JWT、服务间凭据和模型连接；真实配置不要提交到仓库。数据库迁移只对明确指定的开发/测试库执行。分别在对应服务目录启动：

```sh
# campus-overflow-ai/backend
uv venv
uv pip install -e ".[dev]"
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

```sh
# campus-overflow-ai/frontend
npm ci
npm run dev
```

```sh
# campus-overflow-ai/agent
npm ci
npm run dev
# 正式构建与启动：npm run build / npm start
```

默认端口：Next.js `3000`、FastAPI `8000`、Agent `8787`；启用后的 Workflow 回调默认 `8788`，仅监听 `127.0.0.1`。数据库和内部回调不作为浏览器入口。Agent 正式部署需携带完整 `.output`，并在匹配的操作系统/架构构建。

| 范围 | 检查命令 |
| --- | --- |
| 后端 | `uv run pytest`、`uv run ruff check .`、`uv run lint-imports` |
| 前端 | `npm test`、`npm run lint`、`npm run check:rules`、`npm run build` |
| Agent | `npm test`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm run smoke:workflow`、`npm run smoke:dev` |

[CI 配置](./.github/workflows/ci.yml) 在 main 推送或 PR 时执行各服务已配置的检查；Agent 构建显式使用 4GB V8 堆。上表包括本地可执行检查，不代表每一项均已配置进 CI。

## 验证证据与剩余工作

- Agent 最近一次 Linux Node 22 验证：491 项测试、lint、类型检查、正式构建、Workflow/dev 冒烟通过；独立产物的真实 Postgres World 运行冒烟通过。见 [Linux 构建修复记录](./docs/审查记录/AgentLinuxCIRollup修复/审查记录.md)。
- WF-05 后端验证：726 项通过、26 项跳过；另在真实 MySQL 上完成 6 项专项。跳过项目不视为通过。
- 真实 FastAPI/MySQL/PostgreSQL 加模型 HTTP 替身的联调覆盖：五轮预算、版本冲突修订、逐项审批、Agent/PG 重启、丢响应找回原回执和历史内容分页。见 [WF-05 验收记录](./docs/审查记录/WF-05六项修复/C验收与收口.md)。
- 2026-11-03 用户反馈 CI/CD 成功；本轮未直接读取远端运行日志，也未核验线上治理开关。

下一阶段仍需完成：

1. 落实学生零工具调用的权限要求并补聊天、任务入口越权测试。
2. 补完前端交互及真实浏览器验收。
3. 使用真实模型评估误判、引用准确性、效果判断、停止决策、延迟与成本；HTTP 替身测试只证明编排与安全链路。
4. 验证生产配置、完整部署、灰度开关、备份恢复、告警及审计归档；补多实例调度、并发负载与队列积压测试。
5. 按独立计划补齐教材 embedding、混合召回和重排；现有 Markdown 目录不等于完整 RAG 检索链。
6. 对齐历史任务的父子状态和已被后续验收覆盖的缺口，保留验证证据及未完成项。

## 文档入口

- [项目宪法](./specs/constitution.md)、[功能规格](./specs/spec.md)、[技术方案](./specs/plan.md)、[任务清单](./specs/tasks.md)、[一致性分析](./specs/analyze.md)
- [后端架构说明](./docs/后端架构说明.md)、[前端服务需求](./docs/前端架构/前端服务需求文档.md)、[Agent 运行说明](./campus-overflow-ai/agent/README.md)
- [依赖说明](./docs/依赖说明.md)、[规格驱动流程](./docs/workflow.md)、[开发协作流程](./docs/开发协作流程文档.md)
- [WF-04 故障验收](./docs/审查记录/WF-04持久故障验收/审查记录.md)、[WF-05 六项修复](./docs/superpowers/plans/2026-11-02-workflow-six-fixes.md)

早期阶段资料归档于 [_archive](./_archive)。出现历史描述冲突时，按最新用户决定及当前规格核对代码，不以旧任务勾选代替实际验收。
