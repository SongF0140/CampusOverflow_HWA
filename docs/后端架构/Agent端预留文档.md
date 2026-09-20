# Agent 端预留文档（第一期占位 → 第二阶段实施）

> 依据：spec v3（Q-08：第一期不搭建 Agent 服务）｜权威架构：[docs/后端架构说明.md](../后端架构说明.md)｜端总览：[README](./README.md)
> **二期需求权威文档：`campus-overflow-ai/agent/agent端需求文档.md`（Agent 服务需求文档 · 第一阶段 MVP）**——本文件只记录一期留下的占位、边界规则与二期映射，不重复其内容。

## 1. 定位与边界（Q-08）

第一期不搭建 Agent 服务：Agent 服务（TypeScript + Vercel AI SDK + Hono，端口 8787）整体延后。业务后端本期只做三件事保证"演进留门不预建"：

1. `/internal/agent/*` 前缀在 `app/main.py` 预留注释，**不注册任何路由**。
2. `qa` / `interaction` 的 service 中以 `# TODO(agent)` 注释标出事件发布点，**不改动现有函数签名**。
3. `governance` 建表 + 路由返回 501 占位。

**禁止做（一期）**：

- 不提前实现任何 Agent 逻辑、内部接口处理函数或 MCP 代码。
- 不引入事件总线 / 消息队列（二期升级时再评估）。
- 不在 governance 占位路由里写真实业务逻辑。

## 2. 一期留下的占位清单

| 占位 | 位置 | 形态 | 二期接法 |
| ---- | ---- | ---- | -------- |
| `/internal/agent/*` 前缀 | backend `app/main.py` | 注释预留，不注册路由 | T-12 注册白名单接口 + 服务间 token 鉴权 |
| 事件钩子 | `qa.service`（发布问题 / 发布回答）、`interaction.service`（内容标记） | `# TODO(agent): QuestionPosted / AnswerPosted / ContentFlagged` 注释位 | 以订阅者接入，不改现有函数签名；必要时升级为进程内发布器 |
| governance 建表 | `app/modules/governance/models.py` | ModerationCase / Appeal 已随一期迁移落库 | 二期补 agent_runs / tool_call_logs / agent_memories / approval_requests / mcp_server_configs 迁移 |
| 治理路由占位 | `/api/governance/*` | 501 | 二期由 T-15 实现审批中心真实逻辑 |
| 服务间鉴权 | `core/permissions.py` | 二期新增 `X-Service-Token` 校验函数 | T-12 启用，透传 `x-trace-id` |

## 3. 边界规则（宪法 C-05~C-08，二期生效）

Agent 服务接入后必须遵守，全部为可检查规则：

- **C-05**：Agent 不直接连接 MySQL，只调用 FastAPI `/internal/agent/*` 白名单接口；MCP 工具白名单注册，不绕过 FastAPI 修改核心业务数据。
- **C-06**：高风险动作（删帖、封号、文件写入、内容隐藏）Agent 只能创建待确认工单（approval_requests），人工确认后由 FastAPI 执行。
- **C-07**：持久化记忆可审计，只写摘要不写密码、密钥、隐私原文，写入带 agent_run_id 与来源对象。
- **C-08**：agent run / tool call / approval request 必须记录 trace id、agent_run_id 和调用摘要，可相互关联检索。

## 4. 二期交付映射（T-11~T-17 ↔ agent端需求文档）

| 任务 | 交付内容 | 对应 agent端需求文档 章节 |
| ---- | -------- | ------------------------ |
| T-11 | Agent 服务骨架与单 Agent Loop + task router | §1、§3.1、§3.2 |
| T-12 | `/internal/agent/*` 白名单接口与服务间鉴权、trace id 贯穿 | §4.2 |
| T-13 | 智能标签推荐与相似问题推荐（用户确认后写入，E-09） | §3.2（suggest_tags / similar_questions） |
| T-14 | 持久化记忆（三类记忆、敏感过滤、用户可删除/禁用） | §3.4 |
| T-15 | 内容风险预警与审批中心（七类处置、申诉复核） | §3.5 + 管理员端 3.3 节 |
| T-16 | 观测与审计（trace id 检索完整调用链） | §3.1 步骤 9 + C-08 |
| T-17 | MCP Adapter 白名单接入（mock → 真实） | §3.3 工具白名单 + MCP 部分 |

前端配套（第二阶段）：`/agent/*` 流式 UI（`@ai-sdk/react`，生成中 / 失败重试 / 需人工确认三态）见 agent端需求文档 §3.6。

## 5. 验收（二期）

以 `campus-overflow-ai/agent/agent端需求文档.md` 第 6 节 MVP 验收清单为准，摘要：

- [ ] suggest_tags / similar_questions / moderation_scan / memory_update 四类任务可用
- [ ] 每次运行有唯一 agent_run_id 与 trace id；未注册工具无法被调用
- [ ] Agent 代码库无直连 MySQL 代码（grep 可查）；未带凭证调用内部接口被拒（401）
- [ ] 含密码/密钥/隐私原文的记忆写入被拒绝并留拦截日志
- [ ] Agent 无法直接删帖/封号，只能创建待确认工单
- [ ] vitest 全部通过，eslint 零 error

> 二期启动前：重读 spec v3 与 plan v3 范围标注，重跑 `/speckit.analyze` 后再 implement（specs/analyze.md 最终判定已注明）。
