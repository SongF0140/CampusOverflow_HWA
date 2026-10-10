# 一致性分析报告（Analyze）

## F-C5 助教认证前端与"助教角色口径"一致性复核（2026-10-10，最新有效节点）

触发：PR #28 第二轮评审要求——助教审核入口不得依赖课程管理权限、`/teacher/**` 不得放行助教，并同步文档与重跑一致性分析。
本轮为**规格口径 + 文档同步 + 已有代码复核**，不新增需求、不改后端权限实现。

### 1. 权威口径（本次写死的最终规则）

1. `/teacher/**` 仅「教师 / 管理员」可访问；
2. 已认证研究生助教**不进入教师端**；
3. 助教能力**仅在学生端生效**：回答问题 + 标记推荐回答（US-20 / E-13）；
4. 助教认证审核位于**教师工作台 `/teacher`**，与具体课程无关；
5. 助教不是角色，是学生角色上的附加能力位（`require_graduate_assistant`）。

依据：`specs/spec.md` US-20（助教在学生端使用助教板块）、E-12（本科生/未认证研究生不出现该板块）、E-13、Q-07（不是独立角色）、
`docs/后端架构/教师端接口文档.md` §3（`GET /api/users/assistant-certifications`、`POST /api/users/{id}/assistant-certification/review` 均为 `require_roles(teacher)`）。

### 2. 三条链是否一致

| 维度 | 证据 | 结论 |
| --- | --- | --- |
| 规格 | spec.md US-20 / E-12 / E-13 / Q-07 | 与上述 5 条完全一致（本次未改规格，只把文档追平它） |
| 后端 | `identity/router.py:73/92` 均 `require_roles("teacher")`；`identity/domain.is_graduate_assistant` = 学生 + 研究生 + 认证通过 | 助教是能力位、审核归教师，与规格一致 |
| 前端 | `features/layout/TeacherGuard.tsx` 仅 teacher/admin 放行；助教审核板块挂在 `TeacherWorkspaceView`（`/teacher`），仅 `role === teacher` 渲染；`shared/utils/assistant.ts` 与后端判定三条件逐条一致；回答卡「标记推荐」按能力位渲染 | 与规格、后端一致 |

### 3. 文档同步结果（本次实际改动）

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `docs/前端架构/前端服务需求文档.md` | 角色矩阵（学生端"含助教能力位"、教师端去助教）+ §3.6 权限表去掉"助教"角色列并新增"标记推荐回答（助教能力位）"行 + 验收清单第 2 条改写 + §4.1 接口表三条助教认证接口的"对应页面"改指个人中心与教师工作台 | ✅ 已改 |
| `docs/前端架构/页面控件级设计说明.md` | §1.1 用户菜单去"助教" + §1.2 新增教师端权限口径 + §3.1 新增「助教认证审核板块」规格 + §3.3 删除"底部给助教看审核入口"改为指回 §3.1 + §2.12 补录学生端「助教认证卡」规格（仅学生渲染、pending/approved 禁重复） | ✅ 已改 |
| `.trae/specs/build-frontend-mvp/tasks.md` | F-C5 勾选并记录验证证据 + 新增 2026-10-10 节点说明（F-C6 仍未完成） | ✅ 已改 |
| `specs/analyze.md` | 本段 | ✅ 已改 |

### 4. 判定

- 未发现新的规格冲突；未删除任何正式接口；未改动产品需求范围（T-19/T-20 仍属第三期，未勾选）。
- 前端验证：67 文件 408 项测试、lint 零 error、`check:rules` 0 提示、`next build` 通过（PR #28 合并前复跑）。
- 仍需人工验收：真实浏览器联调由用户完成；本分析不把 F-C6、治理、AI 相关页面或整体项目验收视为完成。
- 结论：**无重大冲突，文档与规格/代码已一致，可重新请求 PR #28 审查。**

## PR27 审查修复实施前复核（2026-10-09）

用户要求修复回答旧锚点不可达、封禁/解禁缺持久审计及过期文档，并确认独立审计表方案及当前数据库仅为本地测试库。本清单完成后统一验收，逐块验证提交、不 push；不实施助教入口、其他问答操作或 T-14～T-18。

已重新核对 constitution/spec/plan/tasks、需求、架构/分层基线、管理员接口及工程规则：US-04/US-16、E-07、AGENTS 高风险审计要求 → plan §6 → R-01～R-03。WHAT 已覆盖，不加入技术细节；新增表与事务均在 identity 内，JWT 操作者经 router 基本类型传参，repository 独占 ORM、只 flush，service 负责 commit/rollback，符合 D-2/D-7/D-8。前端仅使用现存分页契约，不删除任何 PR 正式接口。

历史“封禁已留审计”结论不能证明持久历史，接口差距表与用户指出一致，本轮明确补缺，不将 T-15 全部提前。重复操作留记录、解禁保留历史原因、不增查询页面已获用户确认；UTC 审计时间仅新表，不转换其他表历史时间。Alembic 只增加审计表，本地 upgrade 许可不等于清库许可。业务追加式历史不保证数据库超级用户不可篡改。

判定：上游方案/任务覆盖修复清单，无重大冲突，可实施。热门内容、期限封禁、证据快照/申诉、真实浏览器及整体项目验收保持独立未完成项，不以本清单修复宣称整个前端或治理交付完成。

专项 spec/tasks 同步后再次复核：管理端 SHALL 改为用户名服务端筛选、无限期封禁与持久历史；删除“时长拼接”当前设计，旧任务注记保留为历史。业务 WHAT 未加入表结构/实现细节，HOW 仍归 plan §6，R-03 覆盖文档同步。无新增产品权限或接口，允许继续本清单验证。

结果回填复核：R-01～R-03 实现验证完成不等于人工验收。用户修正权限后在线MySQL迁移成功，当前head为9f27b104c6de；后端启用11项本地MySQL审计专项后全量308通过/9跳过，ruff及5项分层契约通过。新审计时间采用UTC秒精度，与MySQL DATETIME一致；保存点测试不证明多连接并发及真实网络提交失败。前端411项测试及lint/rules/build通过，真实导航为模拟，O(页数)定位及offset并发变动限制在补完计划披露。不将本清单勾选扩大为F-C5/F-C6或治理全部完成。

## 前端补完实施前一致性分析（2026-10-09）

后续节点一致性复核：用户替换 AGENTS 并要求继续，恢复每板块提交后等待人工审查。当前 F-C4 收口后停止，F-C5/F-C6 未获后续批准不实施；仅执行节点变更，不改变产品需求、正式接口、代码范围或安全权限。以下整批审查表述为历史安排，不再授权连续推进。

依据宪法 C-01～C-05、US-02/08/09/10/20、E-06/11/12，已读取主规格与前端专项规格、四份设计文档及三端正式接口、workflow和工程规则。用户授权PR27本地合并后补完，再统一审查，不push；计划见docs/前端补完计划.md，执行任务F-C1～F-C6。

管理员筛选、mine/is_owner/can_post/course_name、用户内容分页、标签详情、助教申请/审核与回答分页均使用现有正式接口，不扩大后端范围。认证页已存在课程→问题→回答详情链路，历史恒空说明过时，不新增全课程候选聚合。缺接口的已解决筛选、限时封禁、扩展统计和课程高级操作明确禁用/暂缓；不以假成功掩盖未完成。治理/AI/部署沿用阶段安排。注册固定student不允许前端自授teacher。A-17/A-23已有本批次任务覆盖，无重大冲突，可按序实施；不宣称整项产品或人工审查完成。

### 上游方案与任务补充后的复核

F-C4 收口复核：专项任务仅勾选已实现且验证的用户内容/标签板块，F-C5/F-C6 保持未完成。新增测试证明实际主页翻页后切用户/页签重置、标签404不继续查问题、零问题标签仍可读取；399项测试及lint/rules/build通过。未改业务权限或后端，公开内容接口仍需登录；未进行真实浏览器联调。此次完成勾选不等于人工批准，按最新节点停止。

本轮新增 plan §5 正式业务契约表、tasks 前端专项索引及 `docs/前端补完计划.md` 的完整依据/映射/验证/决策。实际问题详情挂载旧组件，已写的新组件未接入不能算完成；F-C6 细分为回答编辑删除/分页、问题与回答评论及二级回复/分页、助教推荐双向标记、采纳与问题删除确认、声誉余额纠偏和验收复核，映射 US-03～08/20、E-05/06/10/12/13、Q-01，均有现存正式接口，不改变业务规则。

| 核对项 | 判定 |
| --- | --- |
| 宪法与服务边界 | 中文、测试、lint和现有设计系统；无直连后端/数据库、新增依赖或后端治理扩大 |
| WHAT/HOW/执行对应 | 主规格保留业务需求，plan与补完计划承载接线方案，主tasks索引专项顺序；历史产品冲突不擅自改为已批准 |
| 权限 | 认证只教师本人课程，审核只教师，助教student+postgraduate+approved；删除作者/管理员，编辑作者；JWT与封禁后端校验不放宽 |
| 未完成边界 | 无接口/延期条目显式暂缓，9项MySQL专项skip、真实浏览器联调、人工视觉及最终人工审查不宣称通过 |
| Git与人工节点 | 合并仅本地；逐板块验证后中文提交，不纳入用户临时文件；本次明确授权整批完成后人工审查 |

结论：本批次上游补充无重大冲突，允许按专项顺序实施；A-17任务缺失已有索引，A-23接口接入仍须逐项代码与测试收口，未因分析文档存在而自动完成。

> 当前状态：2026-10-03 T-09/T-10 最小设计与上游一致性更新已整理为待人工批准草案，未实现，不授权 implement。T-08 单向编排、异常回滚及有界候选为已有工作区本地整改，不等于人工审查通过；真实 MySQL 验收缺口保留。T-08/T-09/T-10 均不勾选，最新结论见文末，历史“允许 implement”不是本轮授权。
> 历史状态：2026-09-30 执行第七轮分析（T-02a 实施后回填核对：plan §4/§5 字段与接口定案、tasks.md T-02a 勾选、接口文档路径落定；pytest 45 全绿 + ruff 零 error + lint-imports 四契约全 KEPT + alembic upgrade head 通过）。此前 2026-09-22 第六轮（分层架构基线变更：每模块新增 domain.py 纯规则层 + ORM 不上浮 + DomainError 收口；identity 试点改造完成）。更早 2026-09-20 第五轮（骨架改造对齐架构文档 + 前后端接口对接定案 + 蛇形字段/优质内容认证两项决策落定）
> 命令：`/speckit.analyze`
> 定位："返工预防器"——在 implement 之前检查 spec / plan / tasks 三者一致性，尤其适合中大型项目。

## 分析范围

- specs/spec.md（版本：v3，2026-09-20 角色模型调整：助教并入学生端 + 研究生助教能力位；Agent 服务与治理逻辑标注第二阶段）
- specs/plan.md（版本：v3，2026-09-20 需求覆盖映射更新 + 范围调整注 + 后端目录权威指向 docs/后端架构说明.md；本轮小改：二期模块表述与 Agent 预留文档指向）
- specs/tasks.md（版本：v2 + 2026-09-20 增补 2：T-05 新增优质内容认证接口 POST/DELETE /api/answers/{id}/certify）
- specs/constitution.md（版本：v1，2026-09-03 补充 C-06~C-08）
- 代码现状（2026-09-20 骨架改造后）：backend 6 模块 3.5 层结构 + Alembic 骨架 + governance 占位；frontend 三端路由 + BFF 骨架
- 接口对接依据：docs/前端后端接口对照表.md（D1~D16 / F1~F3 全部闭环）、docs/后端架构/ 三端接口文档、docs/前端架构/前端服务需求文档 §4.1

## 检查结论

| 编号 | 类型 | 描述 | 严重度 | 修复去向 |
| ---- | ---- | ---- | ------ | -------- |
| A-01~A-08 | 已修复 | 历史三轮分析结论（spec/plan/tasks 填充、宪法补全、术语统一、v2 游客裁剪联动等），详见 2026-09-18 第三轮报告记录，均已闭环 | — | 已闭环 |
| A-09 | 已修复 | 2026-09-20 角色模型调整：助教不恢复为独立角色，并入学生端——研究生身份 + 助教认证通过 → 助教能力位。spec v3 新增 US-20（P0）、E-12、E-13、Q-07；plan v3 映射 US-20 → identity（身份字段 + require_graduate_assistant）+ qa（推荐标记）；tasks v2 插入 T-02a（研究生身份与助教能力位，依赖 T-02）、T-05 增补助教推荐标记（仅展示标记，不影响采纳权） | 高 | 已闭环 |
| A-10 | 已修复 | 2026-09-20 范围调整（Q-08）：本期只做业务后端，Agent 服务不搭建。tasks v2 将 T-11~T-17 整体标注第二阶段；T-18 收窄为一期部署范围（backend + MySQL）；T-19/T-20 标注一期自检范围；`/internal/agent/*` 仅保留前缀注释与 TODO 事件钩子；governance 治理逻辑仅建表 + 501 占位；AGENTS.md、README.md 与 docs 范围注释已同步 | 高 | 已闭环 |
| A-11 | 提示 | tasks v2 的 T-03~T-10 描述中残留前端页面完成判定（课程页区块、详情页展示等），不在本期实施范围——随第二阶段前端实现一并验收；执行以 tasks.md 头部"一期实施范围总注"为准 | 低 | 第二阶段启动时随前端任务重述 |
| A-12 | 提示 | 优质内容认证接口（T-05 增补 2，`POST/DELETE /api/answers/{id}/certify`）：spec 无独立用户故事行，但功能概述明确"教师认证优质内容"、E-06 明确"认证越权拒绝"，spec 依据充分；判定为覆盖成立。建议后续 specify 时在 US-10 或新 US 中显式化故事描述 | 低 | 随下次 specify 显式化；T-05 实施时回填 plan 第 5 节接口表 |
| A-13 | 提示 | 治理占位路由前缀 `/api/governance/*`（一期 501）与二期落地路径 `/api/admin/moderation/*`、`/api/admin/approvals/*`、`/api/admin/appeals/*` 不同——已在 docs/前端后端接口对照表.md §0 定案（占位仅一期形态，T-15 实施时按 /api/admin/* 落地并迁移占位） | 低 | T-15 实施时迁移占位路由 |
| A-14 | 已修复 | 字段命名定案（2026-09-20）：接口字段一律蛇形（page_size 等），TS 代码内部仍 camelCase。接口设计指南、开发协作流程文档、学生端 / 教师端接口文档示例、前端服务需求文档 §3.3、AGENTS.md 已全部同步；已实现代码（T-02）与 422→400 归一测试断言一致 | 中 | 已闭环 |
| A-15 | 已修复 | 骨架改造与架构文档一致性：backend 与 docs/后端架构说明.md §7 一致（identity 已实现、governance 建表 + 501 占位、其余模块占位、Alembic env 就绪、app/shared 与实验 tasks 模块删除）；frontend 与 docs/前端架构/前端服务需求文档 §3 路由树一致（三端路由 + BFF api/backend、api/agent）；过时引用（骨架分析第 9 节、agent_gateway、modules/{auth,users}）已在全部有效文档清理，pytest 24 项全绿 + ruff 零 error | 中 | 已闭环 |
| A-16 | 已修复 | 2026-09-22 分层架构基线变更（用户定调"domain/service 为基座、低耦合"）：①每模块新增 domain.py（纯规则、零框架依赖、设计后冻结）——spec/plan 不受影响（纯 HOW 层变更，规则仍由 E-01~E-13 承载）；②ORM 不上浮：models 仅被本模块 repository import，service 出入参一律 schemas（新增 UserAuthInternal 内部模型）；③service 不再抛 HTTPException，改抛 DomainError（core/domain_error.py 纯基类 + core/errors.py 统一映射，BizException 废除）；④pyproject 增加 import-linter 三契约（domain 零框架 / service+router 禁触 models / repository 禁 fastapi）。identity 已试点改造，courses/qa/interaction 建 6 文件占位 stub；后端架构说明.md v3、AGENTS.md、分层架构设计基线.md 已同步。T-03+ 施工作业新增要求：实现 repository 后须在契约 ignore_imports 补 "x.repository → x.models" 行 | 中 | 已闭环；T-03 起按新标准施工并同步契约 |

## spec ↔ plan ↔ tasks 覆盖核对（分阶段）

### 第一期（本期实施：业务后端）

- US-02~US-10、US-15 → T-02（已完成）、T-03~T-10（后端部分 + pytest）
- US-20（研究生助教板块）→ T-02a（identity 身份字段 + `require_graduate_assistant`）+ T-05 增补（qa 助教推荐标记，E-13）
- 功能概述"教师认证优质内容" + E-06 认证越权 → T-05 增补 2（certify 接口，A-12）
- E-12 → 后端侧由 T-02a 验收（403 拒绝）；前端不出现入口的表现随二期
- US-13 / US-14 的数据结构 → governance 建表 + 501 占位（已随骨架改造落库）；业务逻辑延后
- US-16 封禁部分 → T-02 已完成（管理员直接执行 + 审计日志）；申诉部分延后（学生侧 POST /api/appeals 已在接口文档定义，二期 T-15 实现）
- 宪法映射：C-02 → 全部后端任务；C-03 → T-19（一期范围）；C-06 一期形态 = 管理员直接执行 + 审计；C-07/C-08 一期形态 = 表结构 + 占位预留（ModerationCase/Appeal 已含 trace_id、agent_run_id 字段位）

### 第二期（Agent 服务与治理逻辑、前端页面）

- US-11~US-14（业务逻辑）、US-16（申诉）、US-17~US-19 → T-11~T-17
- 前端页面与 E-12 入口表现、E-13 展示标记呈现、/api/users/me/memories（T-14）、/api/admin/agent/runs（T-16）→ 二期前端任务（启动时重述并重跑本分析）
- 宪法映射：C-05 → T-11/T-12；C-06 AI 工单化 → T-15；C-07 → T-14；C-08 → T-16；C-01/C-04 → 前端实现与 T-20 补检

## 修复循环规则

1. 需求冲突 → 修改 spec.md，必要时重跑 clarify。
2. 技术不可行 → 修改 plan.md。
3. 任务覆盖不足 → 重新生成 tasks.md。
4. 修复后重新执行 analyze，直到"无重大冲突"才可进入 implement。

## 最终判定

- [x] 第一期（业务后端）无重大冲突，允许进入 `/speckit.implement`（A-11/A-12/A-13 为低严重度提示，均已记录去向；T-02a 与 T-03 起按 Phase 顺序执行）——**2026-10-06 复核：T-01~T-10 已全部完成（pytest 236 通过 + ruff 零 error + lint-imports 5 契约全 KEPT）**
- [ ] 第二阶段启动前必须重跑本分析（届时以重述后的前端/Agent 任务核对 spec v3 全量故事）

## 第八轮分析（2026-10-06：一期收口 + 二期基座启动）

### 状态变更

1. 一期 T-01~T-10 全部完成并勾选；质量基线：`uv run pytest` 236 passed + 9 skipped、`uv run ruff check .` 零 error、`uv run lint-imports` 5 契约全 KEPT、`uv pip install -e ".[dev]"` 18 依赖导入验证通过。
2. 前端基线修正（2026-10-09）：前端（build-frontend-mvp 规格产物）经"移除→恢复"两次决策后**定案保留于代码基线**（PO 提交 46e3bf8 完整前端 MVP），状态为未完成而非待恢复——原"整体移除（db64fb7）、恢复点 0ab1847"记录作废；同批后端契约接口（`mine`、`is_owner`/`can_post`、`course_name`、`GET /api/users/{id}/questions|answers`、`GET /api/tags/{id}`、PATCH 显式清空）为正式接口，保留不删。
3. 用户决策：Phase 4 的 T-18/T-19/T-20 推迟至**第三期部署阶段**（tasks.md v3 修订已落）。
4. 第二期启动，当前批次 = **T-11 + T-12 基座**；T-13~T-17 随基座联调后逐项推进。

### 二期基座一致性核对

| 编号 | 类型 | 描述 | 严重度 | 修复去向 |
| ---- | ---- | ---- | ------ | -------- |
| A-17 | 提示 | 二期前端任务缺失：tasks.md Phase 3 无前端任务行；frontend/ 已恢复至代码基线（46e3bf8）但未完成——前端补完批次启动时须重述前端任务（A-11 残留的界面验收项一并处理）并重跑本分析 | 低 | 前端补完批次启动时重述 |
| A-18 | 提示 | T-12 需新建 agent_runs / tool_call_logs / agent_memory 三表迁移（governance/models.py 现仅 ModerationCase/Appeal）；plan §5 接口表（memory 读/写、approvals 创建、courses/questions 检索、runs 创建/更新、tool-calls 记录）与 settings.agent_service_token（"dev-agent-token" 默认值）均已预留，实施依据齐备 | 低 | T-12 实施时落迁移 |
| A-19 | 提示 | agent/ 目录 T-01 骨架已就位（package.json 全依赖声明、Node ≥22 ESM、registry.ts 注册结构、Hono 健康检查、vitest/eslint 配置），T-11 在骨架上增量实现，无需从零搭建 | 低 | — |
| A-20 | 提示 | 治理占位路由 /api/governance/*（501）迁移至 /api/admin/* 属 T-15 范围（A-13 既有结论不变），T-11/T-12 不触碰治理业务路由；T-12 新增的 /internal/agent/* 为独立前缀，与占位无冲突 | 低 | T-15 时迁移 |
| A-21 | 提示 | T-13 实施发现标签词表缺口（GET /api/tags 需用户 JWT），plan §5 补 GET /internal/agent/tags 只读端点 | 低 | 已随 T-13 落地 |

### 覆盖核对（二期基座批次）

- C-05（Agent 不直连数据库）→ T-11（registry 白名单）+ T-12（/internal/agent/* 唯一数据通道 + token 鉴权 + x-trace-id 透传）
- US-18/C-08（可追踪）→ T-12 的 runs/tool-calls 接口 + governance 模型 trace_id/agent_run_id 字段位
- T-11 完成判定：流式对话可演示（Hono SSE + AI SDK streamText/ToolLoopAgent）；agent_run_id 每次运行唯一；vitest 覆盖工具注册校验（mock 模型，不依赖真实 LLM）
- 宪法映射：C-05 → 本批次；C-06/C-07/C-08 的业务逻辑分别归 T-15/T-14/T-16，本批次仅保证接口与表结构就位

### 最终判定（本轮）

- [x] **二期基座批次（T-11 + T-12）无重大冲突，允许进入 `/speckit.implement`**（A-17~A-20 均为低严重度提示，去向已记录）
- [ ] T-13~T-17 实施前按批次重跑本分析

### 第七轮补记（2026-09-30，T-02a 实施后）

- T-02a 已完成并勾选：US-20 / Q-07 / E-12 的后端侧全部落地（身份五字段、`require_graduate_assistant`、申请/列表/审核三接口、三类身份边界测试 14 项）。
- 接口定案已回填 plan.md §5（一期已落地表）与学生端/教师端接口文档，与实现一致；无新增需求冲突。
- 文档缺口处置备案：学生端"申请认证"接口原文档缺失，经用户确认补最小申请接口（申请即声明研究生身份），已写入学生端接口文档与审查记录（docs/审查记录/T-02a助教能力位/）。
- 下一任务 T-03（课程模块）无上游阻塞。

### 第八轮补记（2026-10-03，T-08 板块0上游一致性核验）

#### 范围与依据

- 执行已批准的《T08板块0续做与上游一致性核验计划.md》及《T08四步架构改良与业务验收计划.md》板块0；只核验、建立基线、最小对齐文档并重新分析，不实施后续代码整改。
- 已全文读取 AGENTS.md、三份 .trae/rules 规则、specs/{constitution,spec,plan,tasks,analyze}.md、docs/workflow.md、需求文档、后端架构说明、分层架构设计基线、学生端接口文档及 T-07/T-08 相关历史审查记录；核对 backend/pyproject.toml、tests/conftest.py、tests/test_interaction_votes.py 和 QA/interaction/identity 相关实现。
- 依据宪法优先、Q-08 一期只做业务后端、US-06～US-08、E-04～E-06/E-10/E-11、D-2/D-5/D-7/D-8 及 workflow Step 6：上游修改后进入 implement 前必须重跑一致性分析。保留既有用户决策，不在 WHAT 文档加入锁或函数实现细节。
- 本轮仅修改学生端接口文档的 T-08 相关过期说明及本报告；spec/plan/tasks、需求和架构说明已有政策与待实施标注，未发现需要再次改写的本轮直接冲突。分层基线无须放宽。旧规则中 3.5 层及历史 MVP 表述不作为当前实施授权，按 AGENTS、架构权威章节与 Q-08 执行，本轮不开展历史文档清扫。

#### 需求 → 方案 → 任务 → 现状证据

| 需求/边界 | 方案与任务映射 | 代码/测试证据及未实施项 |
| --- | --- | --- |
| US-06、E-05/E-06：仅提问者、每问题最多一项采纳、回答者 +15 | plan 与架构 §4.B 同 Session 编排；T-05 既有采纳 + T-08 声誉及并发验收 | qa.service.accept_answer 已写问题引用/resolved，并调用 grant_reputation 写回答者总分及流水；test_accept_grants_plus15_with_log 覆盖成功路径。顺序重复由领域校验拒绝；采纳列唯一约束不能保证同一问题并发采纳不同回答，MySQL 验收未完成。允许自采纳，但专项断言待补。 |
| US-07、E-04：一条有效票、取消/改票 | T-08 投票状态机、积分事务 | interaction.domain/service 与投票测试覆盖 create/cancel/switch、非法值、有效票唯一及软删目标。问题赞 0 且无流水；回答赞作者 +10；问题/回答被踩作者 -2；取消冲销，改票先冲销再记新票；允许自投与负分。完整投票失败回滚及真实并发仍待验收。 |
| US-08：总分、流水、榜单；Q-04 | identity 拥有用户总分，interaction 拥有流水；T-08 数据库榜单与有界装配 | identity.service 调整总分/查询累计榜；interaction repository 聚合流水。测试覆盖取消/改票流水、课程过滤、窗口排序、缺用户过滤、累计榜零分与前10名。week/month 为滚动7/30天，score 降序/user_id 升序；课程归属按流水 course_id 快照。窗口/课程榜仍读取全候选后批量装配，非有界查询。 |
| E-10：软删与既定积分政策 | spec、需求 §4.7、T-08 验收边界 | qa.service.delete_answer 撤采纳引用、回退 published，不调用积分冲销；回答投票/公开回答计数仅排除回答自身软删，不额外筛父问题。代码符合该口径，但删除后历史 +15 保留及父问题软删影响的专项断言待补；不可把一般软删测试当成全覆盖。 |
| E-11：流水仅本人可见 | T-08 本人流水与公开声誉契约 | interaction.router 从 current_user.id 查询本人流水；公开接口只返回 user_id/username/reputation_score/question_count/answer_count，无 logs。既有测试覆盖本人与公开声誉；通知属 T-10，本轮不实施。 |

#### 现状与目标的边界

- 目标依赖仍为 interaction → QA/identity、QA → identity/courses，禁止 QA → interaction。当前 interaction.repository 仍直接 import QA Answer/Question ORM、返回目标 ORM及积分流水 ORM；qa.service 仍调用 interaction.service 并导入 interaction.domain，D-2/D-5 相关整改尚未完成。
- 四个组合入口目标归 interaction：GET /api/questions、GET /api/questions/{id}、GET /api/questions/{id}/answers、POST /api/answers/{id}/accept；当前仍由 QA router/service 承载。本轮未改变 URL、登录鉴权、采纳仅提问者权限、蛇形字段或 `{ code, data, message }` 统一响应；未来迁移不得改变外部契约。回答列表响应当前为 items/total/page，不擅自新增 page_size 响应字段。
- vote 尚无完整异常回滚包围；accept 的写入与 grant 在 commit 的 IntegrityError 捕获之前，不能把局部 grant 测试（调用方显式 rollback）当作完整投票/采纳失败原子性证据。后续须按既定计划验证事务与锁，不在本轮修代码。
- 四项 import-linter 契约的通过只证明已配置规则；pyproject.toml 仍豁免 interaction.repository → qa.models，且未配置 QA → interaction 方向禁用契约，不证明解耦或无环。

#### 本轮实际验证（backend）

| 命令 | 退出码 | 真实结果 |
| --- | --- | --- |
| uv run pytest -q | 0 | 185 passed，0 failed，0 skipped，2 warnings；300.78 秒 |
| uv run ruff check . | 0 | All checks passed，零 error |
| uv run lint-imports | 0 | 分析60文件、140依赖；4 kept、0 broken；service/router 规则6项豁免，core规则2项豁免 |

- 两项警告为 Starlette/httpx TestClient 弃用提示及 anyio.abc.BlockingPortal 别名弃用；不是业务测试失败，本轮不安装或调整依赖。上述185为本轮实际运行结果，不引用历史185作为替代证据。
- tests/conftest.py 使用 SQLite 内存库、StaticPool、逐测试 create_all/drop_all；本轮未连接专用 MySQL 测试库、未执行 Alembic upgrade/current，未验证实际迁移状态、行锁、隔离级别或并发唯一采纳。迁移文件与历史升级记录不构成本轮数据库证据。

#### Git、审查状态与本轮结论

- 已核验 git status、完整 git diff、git diff --cached 与 git log -5；起始暂存区为空。既有 qa/schemas.py 仅头部投票状态注释改动及未跟踪板块①审查记录均保留，本轮无新增产品代码修改、无新增 Markdown、无暂存/提交/推送。
- 最终完整差异已审阅，git diff --check 退出码0，无空白错误（仅 LF/CRLF 换行提示）；暂存区仍为空，产品代码差异仍仅起始已有的 qa/schemas.py 注释，工作区未新增文件。
- 板块①记录明确历史审查通过；板块②记录有用户批准和历史验证，且当前 Git 存在 identity 解耦提交4ccb382，历史记录的“尚未提交”只代表当时状态。板块③设计草稿仍待审、未实施；不得推定为完成。T-07 任务虽已勾选，审查记录仍待用户审查，批准状态待确认。
- 本轮文档口径已完成核验和最小对齐，但不代表 T-08 整体验收；保留前七轮历史内容，其“允许 implement”判定不是本轮授权。
- 后续整改仍包括 QA 数据所有权收口、单向组合编排、完整事务失败回滚及专用 MySQL 并发验收、窗口/课程榜有界装配和上述政策专项测试。
- **板块0已获用户明确审查通过，并授权进入下一板块①（QA 数据所有权收敛）。** 本次仅实施板块①，验证后停下等待审查；不勾选 T-08，不推进板块②、T-09、前端或 Agent，不自动暂存、提交或推送。此前基线结果仍为板块0证据，不替代板块①验证。

### 板块①实施补记（2026-10-03，QA 数据所有权收敛，待用户审查）

#### 设计依据与实现范围

- 依据已批准四步计划的板块①、US-07/E-04 投票行为、E-10 软删口径及 D-2/D-5/D-7/D-8：QA repository 承接投票目标、票分快照及公开内容计数，QA service 提供内部数据契约；interaction 不再直接读取或更新 QA ORM。
- 新增 VoteTargetData、PublicContentCounts；目标查询具体列并构造 schema，不借用带浏览数副作用的详情能力。票分仍以 SQL 增量写入，仅 flush，由外层 vote 统一 commit；课程快照在 QA 内部读取。
- 删除 interaction.repository 的五个 QA 数据访问函数及跨模块 QA models 豁免。外部 URL、鉴权、错误顺序、投票状态机、积分口径和响应字段不变；既有工作区修改保留。

#### 验证记录

| 命令/检查 | 结果 |
| --- | --- |
| uv run pytest -q tests/test_interaction_votes.py -k 'test_qa_' | 首次5 failed（约定能力缺失）；实现后5 passed、33 deselected、2 warnings |
| uv run pytest -q | 退出码0；190 passed、2 warnings |
| uv run ruff check . | 最终独立运行退出码0；All checks passed |
| uv run lint-imports | 退出码0；60文件、141依赖；4 kept、0 broken；ORM规则豁免由6降为5 |
| uv run python -m compileall -q app tests alembic | 退出码0 |
| QA-first / interaction-first 独立导入 | 两种顺序均成功 |
| git diff --check | 无空白错误，仅 LF/CRLF 提示 |
| 独立只读代码审查 | 未发现本块引入的高置信度正确性、回归或边界问题 |

- 新增5个参数化用例覆盖内部 schema、缺失目标、读取无浏览数/commit 副作用、票分增量 rollback、目标自身软删及父问题软删下回答投票/计数和课程流水快照。两项警告仍为既有 TestClient 与 anyio 弃用提示，未调整依赖。
- 测试使用 SQLite；本块未改表结构、未执行 Alembic 升级、未验证 MySQL 行锁/隔离或并发唯一采纳。

#### 决策与遗留边界

- 复用现有 service/repository，不新增依赖、通用抽象或产品接口。读取软删状态后仍由投票用例判定可见性；回答仅检查自身软删，父问题只提供课程快照。
- QA → interaction 的旧反向调用暂留，采用模块引用并已验证导入顺序；本块不宣称依赖无环。单向组合编排、完整事务失败回滚/MySQL 并发、榜单有界候选、流水 ORM 出参仍待后续整改。
- 本块实施与验证完成，等待用户审查；T-08 整体仍未勾选。未暂存、提交或推送，不自动进入板块②。

### 板块③实施补记（2026-10-03，事务与 MySQL 并发一致性）

#### 依据与源码范围

- 按用户本次授权执行四步计划板块③，保留工作区已有板块①/②改动；依据 US-06/US-07、E-04/E-05/E-06/E-10 及分层基线 D-2/D-5/D-7/D-8，不推进板块④，不修改表结构、依赖或外部接口。
- interaction.service 的 vote/accept 从参与写入到 commit 全部纳入 try/rollback；流水 flush、响应读取或提交异常均回滚。未知 IntegrityError 原样传播，不再误判重复采纳。
- QA repository 提供 Question 与 Question→Answer 锁定读取及 schema 契约，使用 FOR UPDATE/populate_existing 刷新；实际软删、采纳/撤销写入再次使用锁定刷新 get，避免旧快照/identity map。interaction 在锁目标后锁读旧票；有效票不存在时仍由目标锁串行化。锁序为 Question→Answer→有效票→User→流水，User 使用既有积分 SQL 增量写入锁。
- 同题不同回答采纳先锁同一 Question 后校验；问题/回答软删复用同一锁序及完整回滚。父问题软删不额外屏蔽回答投票；自投、自采纳、负分与删除采纳回答不冲销历史 +15 的政策保持。

#### 实际验证

| 命令/检查 | 实际结果 |
| --- | --- |
| uv run pytest tests/test_interaction_votes.py -k outer_log_failure -q（修复前） | 5 failed、50 deselected；故障留下有效票或采纳写入，确认回滚缺口 |
| uv run pytest tests/test_interaction_votes.py tests/test_qa_answers.py tests/test_interaction_mysql_concurrency.py -q -rs（最终源码） | 退出码0；81 passed、9 skipped、2 warnings；179.61 秒 |
| uv run pytest -q（最后锁定刷新写入修改后重跑） | 退出码0；211 passed、9 skipped、2 warnings；295.21 秒 |
| uv run ruff check . | 最终独立运行退出码0；All checks passed |
| uv run lint-imports | 最终运行退出码0；60文件、140依赖；5 kept、0 broken |
| uv run python -m compileall -q app tests | 最终运行退出码0 |
| git diff --check / git diff --cached --stat | 退出码0；无空白错误，暂存区为空；只有既有 LF/CRLF 提示 |

- 新增9个普通参数化实例：vote create/cancel/switch 流水写入后故障（switch 第二笔故障）、accept RuntimeError/未知 IntegrityError、两种目标 identity map 刷新及两种软删提交故障；断言自动回滚票、票分、采纳、总分、流水，Session 可继续使用。删除后历史 +15 保留亦有断言。普通测试使用 SQLite，只证明回滚/刷新契约，不是 MySQL 并发证据。
- 唯一新增文件为 tests/test_interaction_mysql_concurrency.py，9例包含问题/回答三种 toggle、同题不同回答采纳及回答软删与投票/采纳竞争；独立 Session 提前加载旧状态并并发执行。仅读取 TEST_MYSQL_DATABASE_URL，连接前校验 MySQL 且库名含 test；UUID 定向创建/清理本次数据，不建表、drop/truncate 或全库清理。
- 本环境未配置 TEST_MYSQL_DATABASE_URL，因此9例明确 skip（6 toggle、1采纳、2软删竞争），未连接 MySQL。两项 warning 仍是既有 TestClient/httpx 与 anyio 弃用提示，未调整依赖。

#### 环境缺口与审查边界

- 仍须在获授权、已迁移的专用 MySQL 测试库配置 TEST_MYSQL_DATABASE_URL 后运行专项，取得行锁、隔离和并发唯一采纳的真实证据；本次没有执行 Alembic 或操作真实数据库，不读取生产凭据。
- 本块源码和本地验证已完成，但不宣称 MySQL 并发验收完成或人工审核通过；T-08 保持未勾选，板块④榜单等遗留范围不变。未新建 Markdown、未暂存、提交或推送。

### T-08 板块④及独立流水契约整改验证（2026-10-03）

- 依据四步实施计划板块④、US-08/E-11/Q-04 与分层基线 repository 出参 schema 约束，保留已有工作区修改。新增内部 RankCandidateData；流水 SUM 聚合子查询按 score DESC、user_id ASC 做 keyset 分页，SQL limit 限制为 1～100。service 每批调用 identity 批量用户名接口，过滤缺失用户，补足10名或候选耗尽；全站累计榜仍使用 identity 原有 SQL limit10。
- 独立流水整改新增 ReputationLogData，repository 在边界内将 ORM 映射为 Pydantic 数据；外部字段、分页及 JWT 本人范围不变。未修改表结构、索引、依赖、缓存或其他业务。

| 命令/检查 | 本轮真实结果 |
| --- | --- |
| uv run pytest tests/test_interaction_votes.py -k 'bounded_batches or candidate_keyset' -q（实现前） | 3 failed、59 deselected；两例用户名批次110超100，另一例缺失 RankCandidateData |
| uv run pytest tests/test_interaction_votes.py -k rank -q（榜单实现后） | 10 passed、52 deselected、2 warnings |
| uv run pytest tests/test_interaction_votes.py -k internal_contract_and_private -q（流水整改前） | 1 failed、62 deselected；repository 出参仍为 ORM，非 BaseModel |
| uv run pytest tests/test_interaction_votes.py -q（两项整改后） | 退出码0；63 passed、2 warnings；108.24秒 |
| uv run pytest -q -rs（最终源码） | 退出码0；215 passed、9 skipped、2 warnings；302.78秒 |
| uv run ruff check . | 独立运行退出码0；All checks passed |
| uv run lint-imports | 独立运行退出码0；60文件、141依赖；5 kept、0 broken |
| uv run python -m compileall -q app tests alembic | 独立运行退出码0 |
| git diff --check / git diff --cached --stat | 退出码0；无空白错误、暂存区为空；既有 LF/CRLF 提示 |

- 新增4个测试实例：前100候选全部缺失/仅3个有效时跨批补足；210名同分跨页含零分、负分，无重漏；SQL事件确认候选查询有 LIMIT 且每批100、调用者请求1000也受限，用户名批次为100/10；流水 Pydantic 出参、同时间 id 倒序分页、空页及 query user_id 不越过本人权限，外部字段集合保持不变。
- 全量包含最终 limit 下界保护测试。既有滚动7/30天、课程流水快照、同分 user_id 升序及累计榜零分/limit10测试继续通过。两条 warning 为既有 TestClient/httpx、anyio 弃用提示，未更改依赖。
- TEST_MYSQL_DATABASE_URL 未配置，9例 MySQL 并发测试明确跳过；本次未读取数据库凭据、未连接真实 MySQL、未执行迁移。SQLite 验证不能替代 MySQL 锁、隔离、并发或执行计划证据。
- 有界候选装配仅限制每批返回对象与用户名查询参数；聚合子查询仍可能扫描大量流水，跨批重复聚合的数据库扫描成本并不有界。本次未进行 MySQL 性能验证、索引迁移或缓存优化。
- 两项本地整改完成不等于 T-08 整体验收或人工审查通过；T-08 保持未勾选。未新增 Markdown、未暂存、提交或推送。

## 第九轮分析（2026-10-09：前端基线与契约接口定案修正）

### 变更范围

- 用户决策（2026-10-09）：①前端"没做完"而非应删除——PO 提交 46e3bf8 完整前端 MVP 定案保留于代码基线；②46e3bf8 同批后端契约接口有用、不得删除（`mine` 过滤、`is_owner`/`can_post`、`course_name`、`GET /api/users/{id}/questions|answers`、`GET /api/tags/{id}`、PATCH 显式清空）；③更新 spec 使文档与代码基线一致。
- 工作区曾出现删除上述接口的未提交改动（17 个后端文件 + 学生端接口文档，净删 420 行），与决策冲突，已 `git stash` 撤离（stash@{0}），接口全部恢复；后端 ruff 零 error、lint-imports 5 契约 KEPT 复验通过。
- 文档修正（本轮 analyze 触发的上游修改）：tasks.md v3 修订④ + 二期实施范围总注；本报告第八轮状态变更 2 与 A-17；AGENTS.md 范围修订注；.trae/rules/project-context.md、conventions.md 范围注；docs/依赖说明.md 目录注与 §2 状态注。spec.md / plan.md 无"前端已移除"表述，未改动。

### 一致性核对

| 编号 | 类型 | 描述 | 严重度 | 修复去向 |
| ---- | ---- | ---- | ------ | -------- |
| A-22 | 已修复 | 文档"前端已移除/0ab1847 恢复"与代码基线冲突（frontend/ 在基线内且为真实交付）——上述 6 处全部修正为"在基线内、未完成"，契约接口保留决策已写入 tasks.md 与 AGENTS.md | 中 | 已闭环 |
| A-23 | 提示 | 前端未完成项（临时兼容逻辑：`mine` 客户端过滤、`CourseDetail` 缺 `is_owner`/`can_post` 类型等 6 项后端缺口 workaround）不构成接口删除理由——按用户决策保留后端正式接口，前端接入缺口待前端补完批次建立缺口清单逐项收口 | 低 | 前端补完批次处理（A-17 同批次） |
| A-24 | 提示 | stash@{0} 暂存了错误的删接口改动，处置（drop 或留档）待用户确认 | 低 | 用户确认后处置 |

### 最终判定（本轮）

- [x] spec / plan / tasks 与代码基线重新一致（无重大冲突）；本轮为纯文档修正，不改代码、不新增需求，不阻塞当前批次（T-13~T-17 随基座联调）继续 implement
- [ ] 前端补完批次启动时重述前端任务、建立接口缺口清单并重跑本分析（A-17/A-23）

