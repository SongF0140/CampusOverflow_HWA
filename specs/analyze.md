# 一致性分析报告（Analyze）

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

- [x] 第一期（业务后端）无重大冲突，允许进入 `/speckit.implement`（A-11/A-12/A-13 为低严重度提示，均已记录去向；T-02a 与 T-03 起按 Phase 顺序执行）
- [ ] 第二阶段启动前必须重跑本分析（届时以重述后的前端/Agent 任务核对 spec v3 全量故事）

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
