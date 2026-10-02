# T-08 板块③：QA 目标访问解耦设计审查草稿

> **状态：草稿 / 待用户设计审查 / 未实施 / 未运行验证。**
> 日期：2026-10-02。
> 本次仅静态阅读并创建本草稿：不修改代码、规则、规格或已有文档，不勾选任务，不提交、不推送、不运行测试或其他验证命令。候选接口与文件清单均为待审建议，不代表已经批准或落地。

## 一、设计依据

### 1. 已读文档与本板块范围

已阅读 `AGENTS.md`、`specs/constitution.md`、`specs/spec.md`、`specs/plan.md`、`specs/tasks.md`、`specs/analyze.md`、`docs/后端架构说明.md`、`docs/后端架构/分层架构设计基线.md`、`docs/后端架构/学生端接口文档.md`、`docs/接口设计指南.md`，以及同目录的 `板块②identity声誉访问解耦.md`；同时依据工作区编码、约定与项目上下文规则。

- US-06～US-08：采纳、投票、声誉；E-04：一人对同一目标最多一张有效票；E-05/E-06：采纳唯一性和权限；E-10：软删除；E-11：他人积分流水不可见。Q-08 限定本期业务后端范围。
- `specs/tasks.md:57–59` 的 T-08 尚未勾选；`specs/tasks.md:40–45` 的采纳要求涉及同事务积分。此次设计草稿不改变这些状态。
- `docs/后端架构/分层架构设计基线.md:43–50` 的 D-2/D-5/D-7/D-8：ORM 不上浮、跨模块仅调用对方 service 公开函数、service 入参为基本类型、repository 只 flush，最外层 service 用例 commit。
- `docs/后端架构说明.md:55–62` 要求 router 只调用本模块 service、repository 私有、ORM 归所属模块；`:121–122` 要求同事务显式协作，不引事件总线。
- 板块②已经整理 identity 声誉访问，`:65–78` 将 QA 访问及双向 service 依赖留待下一板块。本次不重做 identity，也不扩展治理、通知或其他功能。
- `specs/plan.md:45` 指向后端架构权威文档，不照搬历史模块草案；`specs/analyze.md` 的历史一致性结论不是本次验证结果。

**拟审查目标：**消除 `interaction.repository → qa.models` 直接访问，并让目标读取、投票分快照和内容计数回归 QA 所有权。是否还要求 QA 与 interaction 完全单向依赖，必须单独确认，不能把两个目标混为一谈。

### 2. 实际代码证据与待迁移能力

以下代码路径均相对 `campus-overflow-ai/backend/`，行号为本次静态读取时的行号。

| 文件与行号 | 实际行为 | 对本板块的意义 |
| --- | --- | --- |
| `app/modules/interaction/repository.py:9` | 直接导入 QA 的 `Answer, Question` | 本板块目标越界边 |
| 同文件 `:19–23` | `get_vote_target` 返回问题或回答 ORM，包括软删行 | 跨模块 ORM 泄漏；需要标量/内部 schema 替代 |
| 同文件 `:26–31` | 读取父问题课程，缺失返回 None，不过滤父问题软删 | 回答积分流水课程快照来源，不能遗漏或暗改可见性 |
| 同文件 `:89–108` | SQL 增量更新目标 `vote_score`，flush；回包读分，缺行返回 0 | 快照写读归 QA，参与函数不能自行 commit |
| 同文件 `:140–152` | 问题/回答按作者及自身未软删计数 | 公开声誉也依赖 QA；回答计数未 join 父问题，不能顺手改变口径 |
| `app/modules/interaction/service.py:23–49` | 校验值和类型、读取目标、检查自身软删、toggle、积分、统一 commit，提交后读分 | 保留校验顺序、投票错误及事务边界；不能只迁移一个查询函数 |
| 同文件 `:55–98` | 积分使用目标 id、author_id、问题课程或回答父问题课程 | 内部目标契约必须覆盖这些必要信息 |
| 同文件 `:101–113` | `grant_reputation` 调 identity 增量与本模块流水，不 commit | 已有可复用同事务参与函数，不复制规则或另开 Session |
| 同文件 `:134–144` | 先查公开用户，再查 QA 内容数 | 保留缺失用户 404 和公开响应不含流水 |
| `app/modules/qa/repository.py:23–26,109–112` | 返回问题/回答 schema 的纯读取，包括软删 | 可参考内部 schema 返回方式，不必复用详情用例 |
| 同文件 `:63–68` | 浏览数原子自增并 flush | 与投票目标访问明确分离 |
| 同文件 `:187–207` | 采纳/撤销写入只 flush | 采纳事务协作的现有基础 |
| `app/modules/qa/schemas.py:87–103,141–155` | 现有完整问题/回答 schema 含正文等字段 | 可复用但耦合偏大；轻量内部 schema 更聚焦，名称待审 |
| `pyproject.toml:80–116`，特别 `:114` | 禁 ORM 契约中保留 interaction repository → QA models 豁免 | 未来整改验收需移除这一豁免；当前不得修改 |

interaction 的有效票读写、流水和窗口榜单仍归 interaction repository（`:34–87,111–137,155–175`），不因本次整改转移到 QA。声誉总分仍归 identity。

### 3. 反向依赖不是假设：实际调用链

`app/modules/qa/service.py:10–11` 已导入 interaction domain/service，且实际使用如下：

1. `:97–99` 问题列表调用 `interaction_service.get_my_vote_map`。
2. `:129–133` 问题详情调用同函数，随后增加浏览数并 commit。
3. `:218–220` 回答列表调用同函数。
4. `:271–302` 采纳回答：QA 校验回答和父问题可见性、提问者权限及未采纳条件，写采纳，再调用 `grant_reputation` 发放 +15，最后统一 commit；已有 IntegrityError 回滚及错误映射。

若新增 interaction service → QA service，模块图将成为：

```text
interaction.service → qa.service → interaction.service
                                   ├─ get_my_vote_map（读）
                                   └─ grant_reputation（采纳写）
```

这不一定构成运行时递归，但确实是双向模块依赖，并带来初始化顺序与维护风险。**局部 import 只是加载时机手段，不是消除逻辑依赖环的架构方案。**只移走采纳积分调用，前三处读边仍保留，不能宣称已经无环。

还有上游张力需要用户确认：`docs/后端架构说明.md:70–71` 的依赖表列 QA → identity/courses、interaction → QA/identity，但 `:93–105` 的采纳流程又明确 QA → interaction。当前实际 my_vote 读边进一步扩大反向依赖。此次仅指出，不自行修改权威文档或放宽规则。

## 二、验证记录

### 1. 本次仅静态核对

已确认指定目录存在，且写入前不存在本草稿。已静态阅读上述代码、导入契约及相关测试；没有执行 pytest、ruff、import-linter、Alembic、终端命令或网络验证。本文没有本次通过数、通过结论或性能/并发验证结果。板块②中的历史通过记录不作为本次证据。

| 已读测试与行号 | 静态可见覆盖 | 不能由此推断 |
| --- | --- | --- |
| `tests/test_interaction_votes.py:92–171` | create/cancel/switch、唯一行、非法值/类型、缺失及软删问题、认证/封禁 | 新接口已兼容；父问题软删时回答目标行为已完整覆盖 |
| 同文件 `:188–250` | 积分矩阵、问题赞无流水、取消与改票流水 | 所有失败路径原子性已验证 |
| 同文件 `:270–293,326–342` | 公开计数、用户不存在、课程榜快照 | 父问题软删回答计数口径已有专门断言 |
| 同文件 `:348–384` | identity 增量及 grant_reputation 回滚、流水异常不提前提交 | 完整 vote/accept 失败时所有表都原子回滚 |
| 同文件 `:450–515` | 采纳 +15、hot/votes 排序、my_vote 列表/详情回填 | 采纳异常完整回滚或双向 import 安全 |
| `tests/test_qa_answers.py:223–279` | 采纳状态、非提问者 403、重复采纳 400、软删回答 404、删除已采纳回答回退状态 | 删除时积分冲销；测试未在此断言积分 |
| `tests/conftest.py:14–20` | SQLite 内存库及 StaticPool 测试配置 | MySQL 隔离、并发锁协议、迁移兼容性 |

### 2. 批准实施后的建议验证（本次全部未执行）

建议先补充回归断言，再执行命令，不用现有成功路径代替新边界验证：

- QA 目标访问只返回必要标量/内部 schema，不返回 ORM；问题、回答分别测试不存在/自身软删，并显式锁定父问题软删时回答投票及课程读取的现状语义。
- 目标读取不增加 view_count、不 commit；快照增量保持 SQL 原子增量，参与函数写后 rollback 可还原。
- 投票流水故障注入：有效票行、QA 快照、identity 总分、interaction 流水整体回滚；采纳流水故障注入：采纳引用、状态、总分、流水整体回滚。检查异常发生后是否依赖调用者回滚，不提前声称现有代码已满足全部失败场景。
- 内容计数保留自身软删口径；保留用户不存在 404、hot/votes 排序与批量 my_vote，无 N+1 回退。
- 若选双向协作，检查两种导入顺序及公开函数调用；这只能验证初始化可用，不能证明模块图无环。若选单向方案，补充相应方向约束，并排查残留读边及 domain 常量反向导入。
- 移除目标 ORM 豁免后跑完整契约；现有四项 forbidden 契约没有专门保证 QA/interaction service 无环，契约通过也不能替代依赖图审查。

未来建议在 `campus-overflow-ai/backend/` 执行（**未执行**）：

```powershell
uv run pytest -q tests/test_interaction_votes.py tests/test_qa_answers.py
uv run pytest -q
uv run ruff check .
uv run lint-imports
```

本设计预计不变更表结构，不提出本次迁移执行；若审查后另有结构变更，应先走规格及 Alembic 设计。MySQL 并发重复投票、同目标同时取消/改票、校验与软删竞态仍需另行验证，SQLite 测试不构成证明。

## 三、决策说明

### 1. 候选方案：尚未定案

| 方案 | 做法 | 优点 | 代价与验收边界 |
| --- | --- | --- | --- |
| A：最小显式双向 service 协作 | QA service 提供纯目标/快照/计数公开函数；interaction service 调用，QA 内部 repository 访问所属 models；保留 QA 的采纳与 my_vote 调用 | 最小变更；HTTP 路由、采纳归属和事务结构不动；可清除目标 ORM 豁免 | 保留 QA ↔ interaction 双向 service 依赖。必须显式接受此限制并审查初始化；不能称彻底无环 |
| B：解除采纳积分反向依赖，评估单向编排 | 由 interaction 外层用例编排采纳，调用 QA 的校验/采纳参与函数，再 grant_reputation，同一 Session 统一 commit | 能去掉采纳写反向边，积分编排集中 | 仅移动采纳仍留下三处 my_vote 读边。真正单向还需重排列表/详情的查询装配；变更范围扩大，不能作为局部搬函数实现 |

方案 B 的额外门槛：`app/modules/qa/router.py:191–199` 当前采纳路由只调用本模块 service。不能简单改成 QA router 直接调 interaction service而违反 router 所属约束；保留 QA service 转发也仍留下反向边。需要审查路由注册归属、查询装配归属及保持外部 URL/响应不变的具体方案，未经批准不新增装配层或放宽规则。

可先讨论 A 是否是本板块可接受的阶段性目标，再讨论 B 的范围；这是审查顺序建议，**不是默认选择 A**。若要求本板块一次实现无环，必须把读边和采纳入口一并纳入范围后重审，不能使用局部 import、回调注入或隐藏转发掩盖实际依赖。

不采用新增框架、事件总线、业务编排挪入 core、跨模块 repository 调用、复制积分规则或新建公共 API 包绕过 D-5。无需新增依赖。

### 2. 建议接口责任（名称/签名待审，不是已实现接口）

所有跨模块入口位于 QA service，入参为共用 `db: Session` 与基本类型；SQL 仅在 QA repository。建议能力如下：

| 建议能力 | 输出与行为 | 责任边界 |
| --- | --- | --- |
| `get_vote_target(db, target_type, target_id)` | 轻量内部目标或 None；必要字段建议为 id、author_id、deleted_at、course_id（回答从父问题读取，可为 None） | 纯读，不增浏览数、不 commit；不抛 QA 详情专用错误。interaction 保留非法类型/值、缺失/软删目标的投票错误映射 |
| `adjust_vote_score(db, target_type, target_id, delta)` | 无返回；SQL `vote_score + delta` 并 flush | 不做票向或积分规则，不独立提交；最外层投票用例承担 commit |
| `get_vote_score(db, target_type, target_id)` | 最新整数快照；现状缺行返回 0 | 保留提交后读分时点及缺行语义，不顺手换成 404 |
| `get_public_content_counts(db, user_id)` | question_count/answer_count 的标量结果 | 按内容自身未软删计数，无父问题额外过滤；用户存在性仍由 interaction 调 identity 检查 |

目标课程可在轻量内部目标中一并提供，或另设纯课程读取入口；需用户确认查询次数与契约取舍，两者都必须覆盖原 `get_question_course_id` 能力。不复用会增加浏览数并 commit 的 `qa.service.get_question_detail`（`:120–148`），也不复用采纳的父问题可见性校验替代现有投票校验。

返回结构可选：复用现有 QuestionResponse/AnswerResponse，变更少但携带正文且绑定展示字段；或在 QA schemas 新增轻量内部目标，字段少且不暴露 ORM。倾向讨论轻量结构，但不在设计审查前定案。DTO 是内部返回值，不增加 HTTP 接口，也不改变 service 入参约束。

若选择 B，再设计 QA 采纳参与函数：负责 QA 可见性、权限、唯一采纳校验及写入，返回积分所需标量，不 commit、不自行发积分；interaction 编排同 Session 发放 +15 并提交。其错误/异常处理需保持现有 HTTP 语义，不能把所有失败都改成同一种错误。

### 3. 行为不变清单

- 首次投票 create，同向 cancel，反向 switch；有效票唯一性及增量分别为 value、-value、2×value。错误校验顺序、400/404、登录/封禁门槛保持原状。
- 投票只检查目标自身软删；回答父问题课程查询不筛父问题软删。若认为该口径需要改变，另列需求决策，不混入边界重构。
- 采纳仍检查回答及父问题可见性，仅提问者可采纳，一题一次；保持权限、错误、响应与 URL。
- 目标访问不增加浏览数、不产生提前 commit；同一 Session 内维护票行、QA 快照、identity 总分与流水，最外层用例一次提交。
- 积分常量依据 `interaction/domain.py:15–26,97–111`：采纳 +15，回答被赞 +10，问题被赞 0 且无流水，内容被踩 -2，取消取反，改票冲销加新票两条流水；不调整课程快照、榜单窗口或本人流水权限。
- `qa/service.py:255–268` 删除已采纳回答会撤销引用/回退状态，目前未冲销 +15；此次保持现状，不偷偷增加积分政策。旧 docstring/接口占位文字不凌驾于已落地调用链；文档差异另待确认。

### 4. 预计触及文件（仅未来实施清单）

方案 A 预计：

- `campus-overflow-ai/backend/app/modules/qa/repository.py`：承接全部 QA 表读写/计数能力。
- `campus-overflow-ai/backend/app/modules/qa/service.py`：公开纯读及同事务参与函数；审查双向加载方式。
- `campus-overflow-ai/backend/app/modules/qa/schemas.py`：仅在选择轻量内部目标时新增返回契约。
- `campus-overflow-ai/backend/app/modules/interaction/repository.py`：移除 QA models 导入及相关能力，保留所属票表/流水访问。
- `campus-overflow-ai/backend/app/modules/interaction/service.py`：改为显式 QA service 协作，不接收 ORM。
- `campus-overflow-ai/backend/pyproject.toml`：移除目标越界豁免及过时说明；是否补依赖方向契约须与选定方案一致。
- `campus-overflow-ai/backend/tests/test_interaction_votes.py`、`tests/test_qa_answers.py`：边界/失败原子性与行为回归；视需要补入既有 QA 测试文件，不默认新增测试框架。

方案 B 还可能涉及 QA/interaction router 及主路由装配、查询响应装配、domain 常量使用方向、对应权限/详情/列表测试，以及架构/规格一致性分析；这些均需扩大范围批准，不是当前已授权改动。identity、数据库表、迁移及其他服务不应默认触及。

### 5. 待确认决策与剩余风险

1. 本板块验收是仅清除跨模块 ORM 访问，还是要求 QA/interaction 完全无环？是否接受方案 A 的明确阶段性双向依赖？
2. 如何解释/修订架构依赖表与采纳流程的张力？若选 B，谁拥有外层采纳事务及列表/详情 my_vote 装配，如何满足 router 只调本模块 service？
3. 轻量内部目标还是现有 schema；课程快照合并目标查询还是独立能力；内部返回契约字段与错误责任需确认。
4. 是否认可保留父问题软删时回答投票/计数现状及删除采纳回答不冲销积分？任何政策变化都应另立需求，不用本次重构掩盖。
5. 现有成功路径和 grant 局部回滚测试不证明完整 vote/accept 故障原子性；需新增失败注入与真实数据库并发验证。目标校验与并发删除、投票唯一约束冲突如何处理仍是风险，不能靠搬动接口宣布解决。
6. 删除 ORM 豁免不等于消除循环；当前四契约未专门约束 service 环。选择 A 应如实记录残余环，选择单向方案才设计并验证方向契约。

**审查结论留空：待用户设计审查。批准前不进入实施，不修改任务勾选、现有文档或工程配置。**
