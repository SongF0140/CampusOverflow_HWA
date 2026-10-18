# Agent 端接入文档（第一期占位 → 第二阶段实施）

## 2026-10-18 增量：用户运行身份链路（G-02）

Agent `/agent/chat`、`/agent/tasks/:type` 及后续 `/agent/*` 用户入口先经后端 principal 校验，再创建运行或调用模型；`/health` 与 `/agent/health` 探针公开。BFF 仅从 co_token Cookie 获取 JWT，不转发浏览器自报 Authorization、角色、用户 ID、Cookie 或服务 token，透传或生成同一 trace_id。

新增以下双凭证只读入口，均须有效 X-Service-Token 与用户 Bearer JWT，每次数据请求重新检查账号状态：

- GET /internal/agent/user/courses/search：keyword、limit，复用课程公开检索。
- GET /internal/agent/user/questions/search：keyword、course_id、tags、limit，复用问题公开检索，排除隐藏与删除内容。
- GET /internal/agent/user/tags：limit，返回站内标签候选词表。

现行规则允许登录用户读取共享课程、公开问题和标签；不是只有选课成员才能检索，也不因此获得成员管理、记忆或治理权限。原无 user 前缀的服务级接口保持原契约，仅供可信内部调用。用户运行客户端固定使用 user 路径，不因鉴权失败回落服务级入口。

客户端和工具注册表逐请求创建，用户凭证只在请求闭包中用于后端调用，不交给模型，不落运行日志。后端返回的最小 principal 经 Zod 校验后冻结，并传入运行上下文。记录当前仍为内存实现，持久化归 G-04；模型整体停止与取消归 G-05。本块未完成私人记忆管理、Wiki 或真实模型联调。

## 2026-10-18 增量：可信身份解析（G-01）

`GET /internal/agent/principal` 为只读白名单接口，必须同时提供有效 `X-Service-Token` 与用户 `Authorization: Bearer <JWT>`；不采用决策接口的二选一认证。成功返回 `{ code: 200, data: { user_id, role, status, identity_type, assistant_cert_status }, message: "身份已验证" }`，仅输出数据库当前身份，不返回个人资料或凭证。

服务凭证或用户凭证缺失/错误/过期、用户不存在均为 401，已封禁用户为 403。`X-Trace-Id` 透传或生成后回显。请求参数及自报角色头不能指定或替换用户。本接口不授予课程、记忆或治理权限；G-02 仍需完成 Agent 入口、BFF 与工具数据接口的逐次授权。

用户已确认的受控规划、记忆与 Wiki 权限见 `../Agent层设计与实施分期.md`；实施任务为 `../../specs/tasks.md` 的 G-01～G-06。本节优先于下文旧阶段说明；既有业务内部接口不因 G-01 新增而自动获得用户隔离。

> 依据：spec v3（Q-08：第一期不搭建 Agent 服务）｜权威架构：[docs/后端架构说明.md](../后端架构说明.md)｜端总览：[README](./README.md)
> **二期需求权威文档：`campus-overflow-ai/agent/agent端需求文档.md`（Agent 服务需求文档 · 第一阶段 MVP）**——本文件记录一期占位的演进结果、边界规则与二期映射，不重复其内容。
> 状态（2026-10-10）：T-11～T-13 已完成；T-14～T-17 尚未完成。

## 1. 定位与边界（Q-08）

第一期没有搭建 Agent 服务；以下三项是当时留下的历史基线。第二期启动后，T-11～T-13 已在此基线上完成 Agent 骨架、内部白名单接口及推荐任务：

1. `/internal/agent/*` 最初仅在 `app/main.py` 预留；T-12 已注册白名单路由。
2. `qa` / `interaction` 的 service 中以 `# TODO(agent)` 注释标出事件发布点，**不改动现有函数签名**。
3. `governance` 建表 + 路由返回 501 占位。

**禁止做（一期）**：

- 不提前实现任何 Agent 逻辑、内部接口处理函数或 MCP 代码。
- 不引入事件总线 / 消息队列（二期升级时再评估）。
- 不在 governance 占位路由里写真实业务逻辑。

## 2. 占位演进状态

| 占位 | 位置 | 形态 | 二期接法 |
| ---- | ---- | ---- | -------- |
| `/internal/agent/*` 前缀 | backend `app/main.py`、`governance/router_internal.py` | T-12 已注册白名单接口，并启用服务间 token 鉴权与 trace id 透传 | T-14～T-16 按任务补齐记忆、审批与观测业务闭环 |
| 事件钩子 | `qa.service`（发布问题 / 发布回答）、`interaction.service`（内容标记） | `# TODO(agent): QuestionPosted / AnswerPosted / ContentFlagged` 注释位 | 以订阅者接入，不改现有函数签名；必要时升级为进程内发布器 |
| governance 建表 | `app/modules/governance/models.py` | ModerationCase / Appeal 及 T-12 的 AgentRun / ToolCallLog / AgentMemory 已落库 | approval/MCP 独立配置结构随 T-15/T-17 再定案，不预宣称已实现 |
| 治理路由占位 | `/api/governance/*` | 501 | 二期由 T-15 实现审批中心真实逻辑 |
| 服务间鉴权 | `governance/router_internal.py` | T-12 已实现 `X-Service-Token` 校验，透传或生成 `X-Trace-Id` | 所有新增内部接口继续复用该依赖 |

## 3. 边界规则（宪法 C-05~C-08，二期生效）

Agent 服务接入后必须遵守，全部为可检查规则：

- **C-05**：Agent 不直接连接 MySQL，只调用 FastAPI `/internal/agent/*` 白名单接口；MCP 工具白名单注册，不绕过 FastAPI 修改核心业务数据。
- **C-06**：高风险动作（删帖、封号、文件写入、内容隐藏）Agent 只能创建待确认工单（approval_requests），人工确认后由 FastAPI 执行。
- **C-07**：持久化记忆可审计，只写摘要不写密码、密钥、隐私原文，写入带 agent_run_id 与来源对象。
- **C-08**：agent run / tool call / approval request 必须记录 trace id、agent_run_id 和调用摘要，可相互关联检索。

## 4. 二期交付映射（T-11~T-17 ↔ agent端需求文档）

| 任务 | 交付内容 | 对应 agent端需求文档 章节 |
| ---- | -------- | ------------------------ |
| T-11（已完成） | Agent 服务骨架与单 Agent Loop + task router | §1、§3.1、§3.2 |
| T-12（已完成） | `/internal/agent/*` 白名单接口与服务间鉴权、trace id 贯穿 | §4.2 |
| T-13（已完成） | 智能标签推荐与相似问题推荐（用户确认后写入，E-09） | §3.2（suggest_tags / similar_questions） |
| T-14 | 持久化记忆（三类记忆、敏感过滤、用户可删除/禁用） | §3.4 |
| T-15 | 内容风险预警与审批中心（七类处置、申诉复核） | §3.5 + 管理员端 3.3 节 |
| T-16 | 观测与审计（trace id 检索完整调用链） | §3.1 步骤 9 + C-08 |
| T-17 | MCP Adapter 白名单接入（mock → 真实） | §3.3 工具白名单 + MCP 部分 |

前端配套（第二阶段）：`/agent/*` 流式 UI（`@ai-sdk/react`，生成中 / 失败重试 / 需人工确认三态）见 agent端需求文档 §3.6。

## 5. 验收（二期）

以 `campus-overflow-ai/agent/agent端需求文档.md` 第 6 节 MVP 验收清单为准，摘要：

- [x] suggest_tags / similar_questions 两类推荐任务可用（T-13）
- [x] 每次运行有唯一 agent_run_id 与 trace id；未注册工具无法被调用（T-11 基座）
- [x] Agent 代码库无直连 MySQL 代码；未带凭证调用内部接口被拒（401）（T-12）
- [ ] moderation_scan 的工单闭环与 memory_update 任务分别随 T-15/T-14 完成
- [ ] 含密码/密钥/隐私原文的记忆写入被拒绝并留拦截日志
- [ ] Agent 无法直接删帖/封号，只能创建待确认工单
- [x] T-13 收尾记录：vitest 45/45、eslint 与 TypeScript 检查通过（详见 `specs/tasks.md`）

> 二期启动前：重读 spec v3 与 plan v3 范围标注，重跑 `/speckit.analyze` 后再 implement（specs/analyze.md 最终判定已注明）。
