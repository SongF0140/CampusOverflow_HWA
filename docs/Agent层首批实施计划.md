# Agent 受控运行主干实施计划

日期：2026-10-18。依据：用户确认的《Agent层设计与实施分期》与 specs/spec.md AG-R01～06。

**目标**：在现有服务上建立可信身份、受控 PlanList 与持久可追踪的运行主干。

**架构**：继续使用 Hono + AI SDK + Zod；FastAPI 统一校验身份、数据权限与持久化。顺序执行计划，确定性工具策略约束模型。

**约束**：中文文案；Node ≥22、Python ≥3.11；Agent 不直连数据库；接口蛇形；后端分层契约不变；不输出敏感原文；高风险操作人工确认。逐块先失败测试、再实现、验证、中文提交、人工审查，不自动推送。按仓库工作流执行，无需另建用户聊天或调度子代理。

## G-01：只读可信身份接口

文件：backend/app/modules/governance/router_internal.py、schemas.py；新增 tests/test_agent_principal.py；更新接入文档。

输入：服务 token、用户 Bearer JWT、可选 X-Trace-Id。输出：GET /internal/agent/principal 的统一信封，data 为 user_id/role/status/identity_type/assistant_cert_status。复用 core.permissions.CurrentUser 与已有 ServiceAuth；DB 是身份真值源。

- [x] 测试两种凭证必须同时有效、学生/教师/管理员、当前数据库角色覆盖 JWT 旧角色、过期/错误 JWT、已删除用户、封禁、伪造查询/头部不能切身份、敏感字段不回传、trace_id。
- [x] 执行新测试，确认因接口缺失而失败（16 项均因 404 失败）。
- [x] 声明身份出参 schema，新增只读路由，不新增数据库或业务写操作。
- [x] 跑新测试及既有内部接口测试、ruff 与 lint-imports（70 passed，ruff 通过，5 条契约通过）。
- [x] 人工审查 G-01；用户在评审修正后明确“审查完毕，继续”，记录见 docs/审查记录/G-01可信身份解析/审查记录.md。

## G-02：用户身份传递与运行上下文

文件：frontend/src/app/api/agent/[...path]/route.ts 与测试；agent/src/internal-client.ts、app.ts、observability/run-context.ts 及对应测试；后端工具数据接口与相关测试按授权需要修改。

消费 G-01 接口，产出后端确认的 readonly principal。生产请求不能跳过鉴权；前端 co_token 优先于浏览器自报 Authorization，坏 Cookie 不造成 500，凭证不写日志。仅健康探针公开。工具客户端携带用户凭证，后端按现有规则复核数据范围；不将身份快照等同于课程管理权限。

接线细化：新增 `/internal/agent/user/courses/search`、`/user/questions/search`、`/user/tags`（共同前缀 `/internal/agent`），同时校验服务和用户凭证，复用既有登录后可读的共享课程/问题/标签查询；隐藏和删除过滤沿用后端。原服务级入口保留契约，用户运行客户端只使用 user 路径，无认证失败回落。每次请求独立创建内部客户端和工具注册表，凭证只在请求闭包中传递，不进入模型、运行记录或 principal。身份解析及数据调用均使用请求取消信号及有限网络超时。

- [x] 先写 BFF 凭证/trace 与 Agent 未授权请求不调用模型的失败测试。
- [x] 实现身份解析客户端、Agent 入口鉴权、运行上下文与数据接口授权；请求级工具装配避免身份串用。
- [x] 后端 41 项、Agent 62 项、BFF 16 项通过；三服务相关 lint/类型/规则和 5 条后端分层契约通过，验证见 docs/Agent层验证记录/G-02.md。
- [x] 人工审查 G-02；用户于 2026-10-21 确认通过并授权进入 G-03，记录见 docs/审查记录/G-02用户身份链路/审查记录.md。

## G-03：受控 PlanList

文件：agent/src/loop/、tools/registry.ts、tasks/ 与 tests/；计划契约在 agent/src/types/。

消费可信 principal 和工具集；产出已校验的计划步骤及执行结果。初始最多 8 步，累计最多 12 次工具调用，返工最多一次。工具执行不能使用模型指定用户或角色作为授权依据。

- [x] 先写未知工具、参数非法、越权、预算累计、真实候选和默认客户端缺位测试。
- [x] 实现计划生成、顺序执行、结果引用校验及现有任务接入。
- [x] 跑专项测试、Agent lint/类型检查（74 passed，tsc/eslint 通过），记录见 docs/Agent层验证记录/G-03.md；人工待审查。

### G-03-C：四类任务的只读上下文补齐（2026-10-22）

承接工作区已有的 doc_draft、moderation_scan、正文接口及客户端改动，不重写计划执行器或 app.ts。文档草稿通过 searchQuestions 收集课程范围内参考；风险扫描通过 fetchModerationTarget 获取可见原文，不可用时标明依据请求方摘录，401/403 不降级。新增接口仍由 FastAPI 双凭证鉴权，目标、父问题、父回答、父评论的可见性在查询中一起过滤，统一 404，不引入任何处置或浏览量更新。

- [x] 增加来源、凭证、目标匹配、父级可见性与只读测试，先复现缺口再修复。
- [x] 后端 72 项、Agent 相关 69 项通过，类型/lint/分层检查通过；证据见 docs/Agent层验证记录/G-03-C.md。
- [x] 人工审查 G-03-C；用户于 2026-10-22 回复“继续”，记录见 docs/审查记录/G-03-C只读上下文/审查记录.md。G-04 尚未启动。当前模板计划与旧聊天循环不等于目标架构已完全模型化。

### G-03-U：统一受控规划入口（实现验证完成，U2 待审查）

按用户选择的 A 方案，收口聊天与四类任务的模型 PlanList 入口，复用同一运行的工具白名单和预算，保留真实候选、来源标注与权限失效不降级等约束。此项是既有 AG-R02 的交付缺口，不能用确定性单步模板或旧聊天工具循环代替。G-03-C 审查通过后实施，先于 G-04 收口。

- [x] G-03-U1：预算由 RunContext 持有，失败和异常后保留累计值；每步复核白名单与风险，401/403 立即停止，引用只允许自有字段；相关 8 文件 77 passed，类型与 lint 通过，用户已审查通过，见 docs/审查记录/G-03-U1运行预算/审查记录.md。
- [x] G-03-U2：统一模型规划接线及任务范围/来源回归，沿用 U1 预算；相关 11 文件 102 passed，类型与 lint 通过，人工待审查，见 docs/Agent层验证记录/G-03-U2.md。

## G-04：持久化观测

文件：agent/src/observability/、internal-client.ts；backend governance schemas/domain/repository/service_internal/router_internal、alembic/versions/ 与 tests/。

消费 agent_run_id/trace_id/principal；产出脱敏、按用户归属的运行和步骤记录。创建记录失败不执行，执行中记录失败停止。数据变更需显式增量迁移；不自动重放成功步骤。

- [ ] 先写审计失败阻断、脱敏、归属及终态测试。
- [ ] 补齐后端记录契约和 Agent 持久记录器，消除生产链路内存记录器依赖。
- [ ] 专项测试、lint、分层、测试库迁移，记录、提交并审查。

## G-05：总结、自检和停止

文件：agent/src/loop/、app.ts、相关 tests/，必要时后端运行状态契约。

消费计划结果和累计预算；产出校验通过的建议或明确失败。单次上游默认 60 秒、整体 180 秒，AbortSignal 贯通；自检不能绕过程序权限或来源校验。

- [ ] 先写不可信来源、超时、取消、返工耗尽及终态错误测试。
- [ ] 实现总结、校验和有限返工，维持现有 SSE 兼容性。
- [ ] 专项测试、相关服务检查，记录、提交并审查。

## G-06：集成验证

文件：三服务现有测试、必要的跨服务测试及审查记录；更新 README/Agent 需求文档中的真实交付状态。

- [ ] 用隔离测试验证用户身份到计划、工具、总结和记录完整链路，覆盖错误分支。
- [ ] 批次收口执行规定全量检查；真实模型/MySQL联调、进程崩溃恢复限制单列，不以 mock 替代。
- [ ] 回填任务和一致性分析，提交待人工验收，不自动发布。
