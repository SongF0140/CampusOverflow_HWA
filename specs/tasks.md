# 任务清单（Tasks）

> 状态：v2（2026-09-20 联动 spec v3：①角色模型调整——助教不设独立角色，研究生助教认证通过后解锁助教板块，新增 T-02a 与 T-05 助教推荐标记（US-20、E-12、E-13、Q-07）；②范围调整——本期只做业务后端，Phase 3（T-11~T-17）整体标注第二阶段（Q-08））
> v3 修订（2026-10-06）：①一期 T-01~T-10 全部完成（pytest 236 通过 + ruff 零 error + lint-imports 5 契约全 KEPT）；②Phase 4 的 T-18/T-19/T-20 整体推迟至第三期部署阶段（用户决策）；③第二期启动，先实施基座 T-11 + T-12（Agent 服务骨架与单 Agent Loop、FastAPI 内部白名单接口与服务间鉴权）；④前端基线修正（2026-10-09）：前端代码位于 `campus-overflow-ai/frontend/`（PO 提交 46e3bf8 完整前端 MVP），状态为**未完成**而非待恢复——原"前端目录已移除（db64fb7）/第三期从 0ab1847 恢复"表述作废；46e3bf8 同批后端契约接口（`mine` 过滤、`is_owner`/`can_post`、`course_name`、`GET /api/users/{id}/questions|answers`、`GET /api/tags/{id}`、PATCH 显式清空）为正式接口，保留不删
> 命令：`/speckit.tasks` → 执行用 `/speckit.implement`（支持 `--continue` 续做）
> 验收标准：每个任务都有目标与完成判定，且可按顺序执行；过大的任务必须拆分。
> 完成后在 `- [ ]` 中打勾。
>
> **一期实施范围总注**：本期只做业务后端。Phase 1~2 为本期实施内容（后端模块与 pytest）；任务描述中涉及前端页面的部分随第二阶段前端实现一并验收；Phase 3 整体为第二阶段，本期不启动。
> **二期实施范围总注（2026-10-10 状态回填）**：第二期实施 Phase 3（Agent 服务与治理逻辑）；T-11～T-13 已完成，T-14～T-17 尚待逐项推进；Phase 4（T-18～T-20）推迟至第三期部署阶段。前端已在代码基线（46e3bf8），F-C1～F-C5 已完成、F-C6 尚未完成；不再适用“从 git 历史恢复 0ab1847”的旧表述。

## Phase 1: 项目搭建与用户基础

- [x] T-01 初始化三服务骨架与工具链（2026-09-03 完成）
  - 目标：frontend（Next.js 16 App Router）/ backend（FastAPI + SQLAlchemy 同步 + Alembic）/ agent（AI SDK 7 + Hono，Node ≥ 22 ESM）三目录骨架、lint、test、dev 启动脚本就绪；各服务提供 `/health`
  - 完成判定：三服务 `/health` 互通；`ruff check .`、`npm run lint`（前端/Agent）零 error；骨架与 docs/项目骨架分析.md 一致
  - 结果：后端 pytest 2 passed + ruff 零 error（uv 环境）；Agent vitest 5 passed + eslint 零 error；前端 vitest 2 passed + eslint 零 error（eslint-config-next 16 原生 flat config）；实测 `frontend /api/health` 返回 `frontend/backend/agent 全 up`；修正 `@ai-sdk/react` 版本为 ^4.0.0（ai@7 对应版本号不同步）；next.config 加 `agentRules: false` 并删除自动生成的 AGENTS/CLAUDE 文件

- [x] T-02 用户注册登录与角色权限（US-02、E-07/E-08）
  - 目标：注册、登录、退出、资料查看编辑；学生/教师/管理员角色；密码加密保存；关键行为日志
  - 完成判定：未登录访问受保护操作被引导登录；越权操作返回禁止；pytest 覆盖认证与权限边界
  - 结果：完成 users/auth 模块（models/schemas/service/router），JWT 认证 + bcrypt 密码哈希，RBAC 角色校验，管理员封禁/解禁，pytest 18 项覆盖注册/登录/越权/封禁边界

- [x] T-02a 研究生身份与助教能力位（US-20、Q-07、E-12）｜依赖：T-02（2026-09-30 完成）
  - 目标：users 表增加研究生身份类型与助教认证字段（身份类型 + 认证状态），Alembic 迁移落库；`core/permissions.py` 新增 `require_graduate_assistant` 依赖——研究生身份且助教认证通过才放行；助教能力不是独立角色，仅是学生角色的附加能力位
  - 完成判定：本科生、未通过助教认证的研究生访问助教板块接口被拒绝（403，E-12 后端侧；前端不出现入口由第二阶段前端保证）；pytest 覆盖本科生 / 未认证研究生 / 已认证研究生三类身份边界；`uv run alembic upgrade head` 迁移可执行
  - 备注：T-05 的助教推荐标记依赖本任务的能力位依赖，必须先完成
  - 结果：users 增加身份类型与助教认证五字段（identity_type / assistant_cert_status / applied_at / reviewed_by / reviewed_at）；能力位判定集中在 `identity/domain.is_graduate_assistant`（student + postgraduate + approved），`UserPrincipal` 扩展能力位字段；落地申请 / 列表 / 审核三接口（申请即声明研究生身份，审核 approve 即时置位，写审计日志）；Alembic 初始迁移落库三表（含治理表）；pytest 45 passed（新增 14 项含三类身份边界）、ruff 零 error、lint-imports 四契约 KEPT、`alembic upgrade head` 执行成功（head = c04234113d33）；接口定案回填 plan.md 第 5 节与学生端/教师端接口文档；审查记录见 docs/审查记录/T-02a助教能力位/

## Phase 2: 核心问答闭环（US-03~US-10、US-15、US-20）

- [x] T-03 课程模块（US-10）（2026-09-30 完成）
  - 目标：课程列表/详情/加入课程；教师管理自己负责的课程；课程页展示问题、标签、活跃用户、高频问题
  - 完成判定：教师不能管理他人课程（管理员除外）；接口测试通过
  - 结果：courses 模块 6 文件按分层基线施工（domain 不变量 `ensure_can_manage` 集中 E-06 判定；Course + CourseMember 两表 Alembic 迁移 head=4ff9e6a9b6e0）；接口 7 个（列表/创建/详情/编辑/join/退出/成员列表）；四聚合区块与 question_count 依赖 qa 随 T-04+ 回填（当前空数组/0）；identity 增跨模块批量用户名函数 `get_usernames_by_ids`（D-5）；pytest 64 passed（新增 19 项，E-06 覆盖学生/他人课程教师/管理员三类身份）、ruff 零 error、lint-imports 四契约 KEPT；接口文档蛇形字段回填学生端/教师端课程节；审查记录见 docs/审查记录/T-03课程模块/

- [x] T-04 问题模块（US-03、E-01/E-02/E-10、X-03）（2026-09-30 完成）
  - 目标：发布/编辑/软删除问题（标题、正文、课程、标签、状态）；Markdown 渲染前 XSS 清洗；详情页完整展示问答闭环
  - 完成判定：空标题/正文不能提交；超长截断提示；软删除后普通列表不可见；脚本内容被清洗
  - 结果：qa 模块 6 文件按分层基线施工（domain 集中 E-01/E-02/X-03/E-10 规则，bleach.Cleaner(tags=[]) 剥离全部 HTML 标签后截断；Questions 表迁移 head=614ffbaac7c4）；接口 5 个（发布/列表/详情/编辑/软删除，/api/questions 前缀）；发布资格=课程负责教师或已加入成员（courses.service.get_course/is_member 跨模块判定，D-5）；内容上限定案标题 ≤100、正文 ≤20000（超长截断 + message 提示，E-02）；列表筛选 course_id/sort=latest|hot/unresolved/keyword，软删不可见（E-10）；详情浏览数原子 +1；标签入参与 tags/vote_score/answer_count 等占位随 T-05/T-07/T-08 回填；pytest 88 passed（新增 24 项：domain 纯规则 7 + 接口 17）、ruff 零 error、lint-imports 四契约 KEPT；接口文档 §3 蛇形回填；审查记录见 docs/审查记录/T-04问题模块/

- [x] T-05 回答与采纳（US-04、US-06、E-05/E-06；US-20/E-13 增补）（2026-09-30 完成）
  - 目标：回答的发布/编辑/软删除；提问者采纳最佳答案并触发声誉变更；采纳答案突出展示
  - 增补（2026-09-20）：answers 增加助教推荐标记字段与标记接口——研究生助教可标记"推荐回答"；标记仅作展示标记，不影响提问者的采纳权与问题状态（E-13）
  - 增补 2（2026-09-20 接口定案，见 docs/前端后端接口对照表.md D9）：新增优质内容认证接口 `POST/DELETE /api/answers/{id}/certify`——教师标记/取消本人任教课程内回答的"优质内容"标记，详情页突出展示；标记不影响采纳权与问题状态
  - 完成判定：一个问题最多一个采纳答案；无权采纳被拒绝；采纳与积分变更一致（同一事务）；无助教能力位用户调用标记接口被拒；非本人任教课程的教师调用 certify 被拒；标记后问题状态与采纳逻辑不受影响
  - 结果：qa 模块扩展（domain 增回答侧异常与 ensure_can_accept/ensure_not_accepted/ensure_can_certify 规则；answers 表 + questions.accepted_answer_id 唯一列迁移 head=f9c6a0c48f93，循环 FK 用 use_alter 标记）；接口 8 个（回答列表/发布/编辑/删除/采纳/推荐/认证置位/认证取消）；采纳事务本期仅落问题侧（置采纳 + resolved，并发由唯一约束兜底），+15 声誉与通知留 TODO 钩子随 T-08/T-10 回填；助教推荐 require_graduate_assistant、教师认证 require_roles(teacher)+负责教师判定均测试覆盖（E-12/E-13/D9）；T-04 占位 answer_count/has_accepted/accepted_answer_id 已回填（列表批量 GROUP BY 避免 N+1）；pytest 110 passed（新增 22 项）、ruff 零 error、lint-imports 四契约 KEPT；接口文档 §4 蛇形回填；审查记录见 docs/审查记录/T-05回答与采纳/

- [x] T-06 评论模块（US-05、E-01/E-10）（2026-10-02 完成）
  - 目标：评论问题/回答，支持二级回复；作者删自己的评论，管理员删违规评论；评论触发通知
  - 完成判定：空评论不能提交；被删除评论普通用户不可见
  - 结果：qa 模块扩展（Comment 模型：question_id/answer_id 二选一 CHECK 约束 + parent_id 自引用二级回复，迁移 head=7d3e9c4a1b52；domain 增评论侧异常与 ensure_comment_can_delete / ensure_parent_in_same_target / ensure_top_level_parent 规则，COMMENT_MAX_LEN=1000 定案审查可调）；接口 5 个（问题/回答评论列表与发表、删除评论，/api/comments 前缀挂 answers 同款 /api 根）；二级规则=父评论须同目标且为顶级（回复的回复 400）；列表分页只作用顶级评论、回复全量归组 replies；删除顶级评论级联软删直接回复（实现补充语义）；X-03 清洗与 E-02 截断复用 bleach 策略；E-07 经 get_current_user 统一拦截并补专项测试；被评论通知留 TODO(T-10) 钩子；pytest 137 passed（新增 25 项：接口 22 + domain 纯规则 3）、ruff 零 error、lint-imports 四契约 KEPT；接口文档 §5 蛇形回填；审查记录见 docs/审查记录/T-06评论模块/

- [x] T-07 标签模块（US-03、E-03/E-09）（2026-10-02 完成）
  - 目标：课程/技术/自定义标签；问题多标签绑定；按标签筛选与热门标签；AI 推荐标签须经用户确认后写入（接口本期仅预留，AI 推荐流程随第二阶段）
  - 完成判定：重复绑定被拒绝；未经确认的 AI 推荐不产生任何写入
  - 结果：qa 模块扩展（Tag 模型 + QuestionTag 关联表复合 PK，迁移 head=a44b1c09079e，tags 唯一性由唯一索引承担避免 MySQL 冗余同义索引；domain 增标签侧异常 5 个与规则 4 个，QUESTION_MAX_TAGS=5 / TAG_NAME_MAX_LEN=50 / HOT_TAGS_LIMIT=10 定案审查可调）；接口 3 组（GET /api/tags 支持 keyword 模糊与 hot 前 10（按可见问题绑定数降序、having count>0、question_count 排除软删问题 E-10）、POST /api/questions/{id}/tags、发布入参增 tag_ids——E-09 仅有发布与绑定两个写入点）；绑定语义=增量追加：请求体 tag_ids 为 [int | str] 二态（int=已有标签 id、str=新自定义标签名内联创建 type=custom，同名全局唯一复用）；重复绑定拒绝（E-03）由应用层校验 + uq_question_tags_pair 唯一约束兜底；每问题标签上限 5 与发布对齐；标签 id 不存在归 400（与标签名同属绑定参数空间，非资源定位失败）；AI 推荐（E-09）仅预留，绑定接口即确认写入点并有"未确认零写入"行为锁定测试；pytest 152 passed（新增 15 项：接口 12 + domain 纯规则 3）、ruff 零 error、lint-imports 四契约 KEPT；接口文档 §3 蛇形回填；遗留：POST /api/tags 官方标签创建（接口指南非必做行）与课程详情 tags 聚合未实现（courses↔qa 循环依赖需单独决策）；审查记录见 docs/审查记录/T-07标签模块/

- [x] T-08 投票与声誉（US-07、US-08、E-04）
  - 目标：问题/回答投票可修改取消；问题赞零分且无流水、回答赞作者 +10、被踩作者 -2、采纳仅回答者 +15；取消冲销、改票先冲销再计新票，允许自投、自采纳和负分；删除已采纳回答撤引用回退状态但不冲销历史 +15；回答投票/公开计数仅检查回答自身软删。声誉及周/月/课程榜基于数据库，不依赖 Redis。
  - 完成判定：每用户每内容仅一个有效票，积分变化必有流水且与票分/采纳状态/总分同事务；滚动 7/30 天榜按 score 降序、user_id 升序，最多 10 名有效用户，课程按流水快照；落实单向依赖与有界榜单装配，并取得专用 MySQL 并发及失败回滚证据，SQLite 不替代并发验收。
  - 结果（2026-10-03）：投票/积分/采纳/通知同事务编排完成；interaction→QA/identity 单向依赖落实（QA 不依赖 interaction 契约 kept）；榜单候选批次有界且同一次分页固定时间窗口；投票/采纳写入路径带行锁与 try/rollback。遗留：专用 MySQL 并发专项 9 项 skipped（本地无专用并发测试库），SQLite 证据不替代并发验收，随部署收尾补验。

- [x] T-09 搜索与筛选（US-09）
  - 目标：关键词搜索（标题+正文）；课程/标签/时间/热度/未解决状态组合筛选；相关问题与热门列表
  - 完成判定：筛选条件可组合；关键词能命中标题或正文
  - 结果（2026-10-03）：GET /api/search（q 1~100 字、转义 LIKE 通配、时间区间须带时区）、GET /api/questions/{id}/related（标签交集降序、最多 10、软删排除）、GET /api/courses（question_count 聚合）、GET /api/courses/{id}（hot/frequent/tags/active_users 真实聚合）、GET /api/courses/{id}/questions。课程读接口由 discovery 提供增强版本，courses 路由仅保留写与成员管理。测试 6 项（tests/test_discovery.py）。

- [x] T-10 通知模块（US-15、E-11）
  - 目标：被回答/被评论/被采纳/审核结果通知；管理员待审核工单通知；标记已读；仅本人可见
  - 完成判定：通知数量与已读状态正确；他人通知不可见
  - 结果（2026-10-03）：notifications 表迁移 e3a7c5d89f12 已应用；GET /api/notifications、POST /api/notifications/{id}/read、POST /api/notifications/read-all。回答/评论/采纳与通知同事务（失败全回滚），收件人去重剔除操作者，自采纳不发通知；unread_count 恒为本人全部未读数；单条/全部已读幂等，非本人 404。审核结果与工单通知属治理二期，不在本期。测试 8 项含主链路验收（tests/test_interaction_notifications.py）。

## Phase 3: Agent 增强与内容治理【第二阶段，实施中（2026-10-06 启动基座）】

> 依据 spec v3 / Q-08：一期不搭建 Agent 服务；`/internal/agent/*` 仅保留前缀注释与 TODO 事件钩子；治理逻辑仅建表 + 501 占位（US-13/US-14 的表结构随 Phase 2 迁移落库，业务逻辑全部延后）。
> 二期启动注（2026-10-06）：T-11 + T-12 为二期基座先行实施；T-13~T-17 依赖基座，随联调逐项推进。
> 扩展注（2026-10-11）：T-16 观浏与审计完成双向闭环工作流扩展——`moderation_cases` 表新增 `manager_feedback`、`agent_decision`、`decision_source`、`updated_at` 字段；状态机扩展为 5 状态；新增决策更新 API。

- [x] 【第二阶段】T-11 Agent 服务骨架与单 Agent Loop（C-05 基础）
  - 目标：Hono + Vercel AI SDK 跑通单 Agent Loop + task router；agent_run_id 生成；工具统一注册在 `agent/src/tools/registry.ts`
  - 完成判定：流式对话可演示；每次运行有唯一 agent_run_id；vitest 覆盖工具注册校验
  - 结果（2026-10-06）：commit b740af5。loop 用 streamText + stopWhen: isStepCount(n)（AI SDK 7 无 maxSteps），结构化输出 generateObject + Zod 自检重试一次；agent_run_id = crypto.randomUUID 每运行唯一；task router 四类任务分发（similar_questions/suggest_tags/moderation_scan/doc_draft）；检索工具经 registry 白名单注册，经 internal-client 调 /internal/agent/* 并透传 x-trace-id；POST /agent/chat SSE 流式可演示。vitest 35/35（mock 模型不依赖真实 LLM）+ eslint 零 error + tsc --noEmit 零错误。遗留：run 摘要内存记录（T-16 持久化）；moderation_scan 仅评估（审批随 T-15）；标签词表拉取随 T-13；MCP 随 T-17

- [x] 【第二阶段】T-12 内部白名单接口与服务间鉴权（C-05）
  - 目标：FastAPI `/internal/agent/*` 白名单接口（检索课程/问题/记忆读写/创建工单）；服务间 token 鉴权；跨服务调用携带 trace id
  - 完成判定：Agent 无任何直连数据库代码；未带凭证调用被拒绝；trace id 全链路传递
  - 结果（2026-10-06）：commit 3ae37e8。governance 扩展为 6 文件完整分层（domain/schemas/repository/service_internal/router_internal）；新增 agent_runs / tool_call_logs / agent_memory 三表（迁移 5d17479735ac 已 upgrade head）；/internal/agent/* 八接口按 plan §5 落地（memory 读/写、approvals 建工单、courses/questions 检索、runs 建/更新、tool-calls 记录）；服务间鉴权 X-Service-Token（未带/错误 401）+ X-Trace-Id 透传；记忆写入敏感词拦截拒绝；工单 source=agent 仅 pending 不处置（C-06）。pytest 244 passed + 9 skipped（原 236 无回归）+ ruff 零 error + lint-imports 5 契约全 KEPT。遗留：记忆删除/禁用接口归 T-14；处置动作归 T-15；agent_memory.course_id 为软引用无 FK

- [x] 【第二阶段】T-13 智能标签推荐与相似问题推荐（US-11、US-12、E-09）
  - 目标：提交前推荐相似问题（含链接）；提交后推荐标签（含理由与置信度）；结果仅建议，用户确认后由后端写入
  - 完成判定：推荐不含站内依据时明确说明；未确认不写入；vitest mock 模型测试通过
  - 结果（2026-10-06）：commit 0e14a95（含词表接口补口）。similar-questions 调 /internal/agent/questions/search 检索 + 模型排序解释，输出含 /questions/{id} 链接；suggest-tags 经新增 GET /internal/agent/tags 词表（plan §5 补行，analyze A-21）从候选集选标签并按名称映射站内 tagId，置信度 + E-09 依据说明（无站内依据时确定性输出"依据为文本语义匹配"）；两任务只读不写（测试断言 post/patch/put 零调用），标签采纳由用户确认后走一期已有绑定接口。vitest 45/45（原 35 无回归）+ eslint/tsc 零错误；pytest 246 passed + 9 skipped（原 244 无回归）+ ruff 零 error + lint-imports 5 契约全 KEPT。附带修复：internal-client 对 {items,total} 信封统一拆包。遗留：词表按 id 升序截 limit（非热度序）；tagId 名称精确匹配映射

- [ ] 【第二阶段】T-14 浏览器个人记忆（US-17、C-07、X-06）
  - 2026-10-22 用户修订：个人记忆按账号隔离保存在浏览器，支持清空，不提供他人个人记忆读取；旧后端记忆入库方案被替代。本轮仅登记，不将旧表/接口视为完成。
  - 目标：浏览器保存用户偏好/课程上下文等授权记忆，切换账号加载对应命名空间；敏感信息（密码/密钥/隐私原文）写入拦截，支持查看与清空，不提供云同步或跨用户管理员读取。
  - 完成判定：切换/退出/重新登录不串用；清空后不继续参与请求和建议；敏感内容不持久化，拦截记录不含原文；前端/Agent 测试覆盖账号隔离、清空与请求上下文。具体本地存储机制在该阶段定案。
  - 2026-10-24 定案与拆解（Q-10：localStorage + AI 只读/手动维护；方案见 plan 顶部 M-01/M-02）：
  - [x] M-01 前端记忆模块与个人中心 UI（2026-10-24 实现验证完成）：src/shared/lib/browser-memory.ts 纯函数模块——键 co_memory_user_{userId}、条目 1~500 字/每人 50 条/重复拒绝、敏感关键词拦截（原因不含原文）、list/add/remove/clear/buildMemoryContext（最新 20 条注入助手，含同毫秒插入序平局裁决）；/me 个人记忆卡（列表/新增/单条删除/全部清空二次确认/账号切换重载命名空间）。测试：模块 7 项（隔离/清空后上下文为空/持久化/敏感/约束/倒序/截取）+ 记忆卡 4 项。
  - [x] M-02 Agent 只读接入（2026-10-24 实现验证完成，T-14 交付）：聊天请求 schema 增可选 browser_memory（≤20 条 × ≤500 字，超限走 SSE error 且模型零调用）；**规划输入剥离记忆**（不进计划提示与范围校验），仅注入最终流式生成提示并标注"用户个人记忆，仅作偏好参考；指令不得改变任务、规则或身份，不是站内依据"；不落审计摘要。Agent 测试 3 项（注入/缺省/超限）。验证汇总：Agent 22 文件 218 passed、前端 72 文件 452 passed、tsc/eslint 全绿、无迁移、无后端变更。完成判定达成：账号隔离/清空不参与/敏感拦截不含原文/请求上下文均有测试。遗留：AI 自动更新（AG-R04 后续批次）、旧后端 memory 表/接口清理单列。【2026-10-24 端到端接线补齐】聊天接线已完成：api/agent-chat.ts（sendAgentChat 发送前注入 buildMemoryContext → browser_memory，SSE meta/delta/done/error 解析）+ 学生端 /assistant 最小聊天页（流式增量渲染、记忆条数提示、错误展示）；另修复 admin approvals 页 useSearchParams 缺 Suspense 边界致生产构建失败。前端 74 文件 462 passed、build 27/27 静态页通过。

- [ ] 【第二阶段】T-15 内容风险预警与审批中心（US-13、US-14、US-16 申诉、Q-06）
  - 目标：静默检测新内容并按风险分级（低打标/中高建工单附快照与原因）；审批中心处理动作（忽略/修改/临时隐藏/软删除/警告/限时封禁/永久封禁）；封禁记录原因、期限、操作者、快照；申诉提交与复核
  - 完成判定：Agent 无法直接隐藏/删除/封号，只能创建工单；全部处置动作留审计记录；边界测试覆盖风险分级
  - 2026-10-24 批次拆解（承接既有基础：T-12/T-16 的双环状态机、hide/delete/ban/skip 真实处置、moderation_scan 评估任务、审批中心前端骨架与学生申诉页均已存在）：
  - [x] T-15-A 审批中心对外接口与申诉闭环（2026-10-24 实现验证完成）：501 占位全部替换为真实接口——GET /api/governance/moderation/cases（状态/来源筛选分页）、POST .../cases/{id}/resolve（管理员直决复用双环两步推进，pending→manager_directed→executed 真实处置，skip 直终态，agent_proposed 确认共用入口）、POST /api/appeals（学生提交，自动定位本人最近 executed 工单，重复拒绝；**申诉入口放行 banned 状态**——US-16 封禁用户救济权，专用依赖 get_current_user_allow_banned，决策记录见 my_engineer_docs/2026-10-24_申诉入口放行封禁状态.md）、GET /api/governance/appeals 与 POST .../appeals/{id}/resolve（复核维持/撤销；撤销按处置回退：ban→解禁、hide→恢复可见、delete→恢复软删，回退与申诉留痕同事务，工单保持 executed 终态）；专项 9 项 + 治理/身份回归 131 passed、ruff 零 error、5 契约 KEPT；无迁移。
  - [x] T-15-B Agent 升级建工单与静默巡检（2026-10-24 实现验证完成）：后端新增 GET /internal/agent/patrol/contents（全站时间窗新内容清单，问题/回答/评论三类 union、回答/评论课程经父问题推导、软删/隐藏排除）与 POST /internal/agent/patrol/cases（判重幂等 repeat、pending 工单 source=agent，C-06 只建单不处置；已结案后复发可再建）；Agent 新增 scheduler/moderation-patrol.ts——默认 15 分钟一轮（可配）、逐条 LLM 风险评估（60 秒限时、无处置权）、中高险且 shouldEscalate 建单（快照截断摘要+原因+trace）、低风险仅审计跳过、单条失败隔离、整轮清单失败 failed 终态下轮重试；服务级无主运行审计贯穿。后端专项 2 项 + 回归 83 passed、Agent 21 文件 215 passed、ruff/eslint/5 契约全绿；无迁移。低风险"打标"当前为运行级审计摘要，内容列标记归 D 批次。
  - [x] T-15-C 治理通知（2026-10-24 实现验证完成）：新增 governance/service_notify.py 复用 T-10 通知机制（type=moderation，前端 NotificationsView 已预留映射）——巡检/工单创建→全部管理员（identity 新增跨模块 get_admin_ids）、处置结果→当事人（skip 也通知"经复核无需处置"的澄清）、申诉提交→管理员、复核结果→申诉人（撤销/维持两种文案）；全部与业务写入同事务（通知失败整体回滚，沿用 T-10"不出现部分成功"口径）；通知跳转链接指向 admin 审批页与申诉页锚点。专项 3 项 + 治理回归 73 passed、ruff 零 error、5 契约 KEPT；无迁移。
  - [x] T-15-D 处置动作补全与前端接数据（2026-10-24 实现验证完成，T-15 整体交付）：①users 表新增 banned_until 可空列（迁移 t15_ban_temp 隔离库三段验证），ban_temp 写入期限（缺省 7 天、1~30 可调、超界 400），**到期惰性解禁**——身份探针/处置探针发现过期即恢复 active 并留系统解禁审计（actor=0），不依赖定时任务；②warn 警告动作——状态与内容不变，审计留痕 + 当事人通知；③决策白名单开放 warn/ban_temp（目标匹配：ban/ban_temp/warn 仅对用户、hide/delete 仅对内容）；④申诉回退覆盖 ban_temp（解禁统一清空原因与期限）；⑤admin 三页接真实数据——审核队列（状态/来源筛选、处理入口）、审批中心（队列+详情+按目标类型条件渲染处置动作组、danger 动作 ConfirmDialog 二次确认、处置时间线展示）、申诉处理（状态筛选、复核说明、撤销/维持）；新增 api/governance.ts 与 shared/types/governance.ts。后端专项 5 项 + 回归 125 passed、前端 68 文件 435 passed、tsc/eslint/ruff/5 契约/迁移全绿。至此 US-13/14/16 全链路交付：静默巡检自动建单 → 审批中心处置（hide/delete/ban/ban_temp/warn）→ 通知 → 申诉 → 复核回退。遗留：edit 动作（要求修改流程）仍不开放；通知链接的 case_id 预填随申诉页增强。

- [ ] 【第二阶段】T-16 观测与审计（US-18、C-08）
  - 目标：agent run / tool call / approval request 记录 trace id、agent_run_id、调用摘要；管理员可查看运行记录与失败原因；记录可互相关联
  - 完成判定：按 trace id 可检索完整调用链；失败运行可定位原因
  - 扩展（2026-10-11）：实现工单双环工作流——`moderation_cases` 新增 `manager_feedback`、`agent_decision`、`decision_source` 字段；新增 `/internal/agent/moderation-cases/{case_id}/decision` 接口；状态机扩展为 `pending → agent_proposed/manager_directed → executed/rejected`
  - 扩展完成判定：状态机迁移合法；决策字段可读写；日志记录 agent 决策与管理员反馈
  - 修复批次（2026-10-11，TDD）：修复假处置（executed 必须同事务真实调用 qa/identity：hide 置三表新列 `is_hidden`、delete 写 `deleted_at`、ban 永久封禁并写审计；全部公开入口+投票过滤隐藏内容）；skip 在 pending 下一次请求直终态 rejected；决策白名单收敛 `hide/delete/ban/skip`（移除 resolve，warn/edit/限时封禁 400 挂后续）；处置前探针 409（不存在/已删/已隐藏/已封禁）；新增 `decision_trace` 追加式轨迹列（迁移 t16_fix_moderation_execution）。定案详见 docs/后端架构说明.md §4.C 修复定案注
  - 2026-10-24 收尾拆解（写入侧已随 G-04/K-04/T-15-B 交付，本批补管理端读取）：
  - [x] T-16-A 管理端观测接口（2026-10-24 实现验证完成）：GET /api/governance/agent-runs（管理员，状态/任务类型/user_id 筛选分页，非法筛选 400）、GET /api/governance/agent-runs/{agent_run_id}（单运行四段聚合：运行+计划/步骤事件+工具调用+同 trace 关联工单）；测试覆盖筛选、失败原因可见（error_summary）、关联聚合与越权 403；专项 2 项。
  - [x] T-16-B admin 运行页接数据（2026-10-24 实现验证完成，T-16 交付）：列表页（/admin/agent/runs，状态 Tab + 任务类型筛选 + 失败行醒目样式 + 失败原因悬浮）与详情页（[id]，运行信息/计划与步骤/工具调用/关联工单四段，面包屑返回）；新增 api/agent-runs.ts；前端测试 6 项。验证汇总：后端专项 2 + 治理回归、前端 70 文件 441 passed、tsc/eslint/ruff/5 契约全绿、无迁移。完成判定达成：按 trace id 可检索完整调用链，失败运行可定位原因。遗留：OpenTelemetry exporter 归部署批次；运行记录的删除/归档运维收敛单列。

- [ ] 【第二阶段】T-17 MCP Adapter 白名单接入（US-19）
  - 目标：用 mock MCP 工具验证 `agent/src/mcp/`（client/registry/policy/adapter）的白名单、策略和日志；再接真实 MCP Server 配置（名称/用途/启用状态/权限范围）；调用记录参数与结果摘要；涉文件/外部网络/发布/审核的工具必须人工确认
  - 完成判定：未注册工具不可被调用；MCP 调用失败不影响核心问答；MCP 不能直改核心业务表
  - 2026-10-24 方向扩展与拆解（Q-11：系统作为 MCP Server 被外部大系统接入，本批只读同步；管理操作后续走审批工单；服务凭证+身份映射登记后续）：
  - [x] N-01 MCP 服务端核心（2026-10-24 实现验证完成）：registry（scope 白名单 read/admin:query/admin:act，管理员工具枚举预留）/policy（Bearer 凭证 timing-safe 映射→scopes，scope 不足拒绝）/audit（结构化日志，参数与结果脱敏摘要复用 sensitive.ts）/server（SDK Server 低阶 setRequestHandler：未注册/scope 不足/入参非法/执行失败均 isError 结果，脱敏原因不透传底层异常）；只读工具 search_questions/search_courses/list_tags 经 service 级 internal-client（MCP 层零 SQL，C-05）；InMemoryTransport + SDK Client 全链路测试 16 项（白名单/策略/审计脱敏/失败隔离/凭证单元）。
  - [x] N-02 HTTP 传输与接线（2026-10-24 实现验证完成，T-17 第一批交付）：Streamable HTTP 无状态模式（会话工厂启动时注入，请求路径只做鉴权与分发——Mimosa 对协议适配层的入口误报以此结构化边界化解）；每请求鉴权 401 + trace（mcp-<uuid>）贯通审计；server.ts 按 MCP_SERVER_ENABLED（默认关）+ MCP_EXTERNAL_CLIENTS + MCP_PORT（默认 8790）开关启动；真实 HTTP 集成测试 3 项（无效凭证 401、SDK Client 完整握手 initialize/listTools/callTool、同进程失败隔离）。验证汇总：Agent 24 文件 237 passed、tsc/eslint 零错误、无迁移、无后端变更。完成判定达成：未注册工具不可被调用；MCP 调用失败不影响核心问答；MCP 不能直改核心业务表。遗留（后续批次）：管理员工具通道（scope admin:*，操作走审批工单+身份映射落地）、持久化调用审计、增量同步接口、Agent 消费外部工具的客户端角色。

## Phase 4: 部署与验收【第三期部署阶段（2026-10-06 用户决策推迟）】

- [ ] 【第三期】T-18 Docker Compose 部署（v2 修订：一期范围 = backend + MySQL；frontend / agent 容器化随第二阶段补充；2026-10-06 v3 修订：整体推迟至第三期部署阶段）
  - 目标：backend + MySQL 容器化；Nginx 统一入口（可选）；不含 Redis（第一阶段）
  - 完成判定：`docker compose up` 一键启动后服务健康检查通过，核心问答主流程可演示

- [ ] 【第三期】T-19 测试补齐（C-03；v2 修订：一期范围 = 后端 pytest 核心流程；前端与 Agent vitest 随第二阶段补齐；2026-10-06 v3 修订：整体推迟至第三期部署阶段）
  - 目标：认证、角色与助教能力位、问答、投票、采纳、通知核心流程 pytest；治理建表与占位接口的边界测试（501 与表结构约束）
  - 完成判定：`uv run pytest` 全部通过且覆盖 E-01~E-13、X-01~X-06 中后端可验证项

- [ ] 【第三期】T-20 宪法自检与收尾（C-01/C-02/C-04；v2 修订：一期自检限于已实现的后端部分，界面条款待前端阶段补检；2026-10-06 v3 修订：整体推迟至第三期部署阶段，与恢复后的前端一并补检）
  - 目标：对照 constitution.md 可适用条款逐条自检——后端 lint 零 error、pytest 全绿、错误消息与接口描述为简体中文、无敏感信息泄漏；C-01 界面文案与 C-04 视觉条款随第二阶段前端实现补检
  - 完成判定：一期自检结果记录到 specs/analyze.md，未适用条款显式标注"待二期"

## 前端补完专项（2026-10-09 用户授权）

后续执行节点修订：用户替换 AGENTS 后要求继续，当前 F-C4 完成验证提交即停下人工审查；未获下一板块批准不连续推进。此前整批审查安排仅保留为历史授权记录。

完整 PR27 已本地合并，前端补完在独立 `feat/frontend-completion` 分支实施，不 push，完成后统一人工审查。范围与方案见 `docs/前端补完计划.md`、plan §5 补充；逐项状态和验证见 `.trae/specs/build-frontend-mvp/tasks.md` 的 F-C1～F-C6。

- [ ] F-C 前端正式契约接入与核心页面补完（子任务按专项清单顺序）：用户筛选、本人课程/资格/课程名、用户内容/标签、助教申请审核、实际问答操作分页及真实缺口复核。完成判定：适用前端测试/lint/rules/build 通过，设计/验证/决策记录就绪；无接口及延期功能仍明确暂缓，不把整个前端 MVP 或人工审查勾为通过。

本批次不推进 T-14～T-18，不以单元测试替代真实 MySQL、部署或人工界面验收；T-19/T-20 整体验收保持原阶段安排。

## Agent 受控运行主干（2026-10-18 用户确认，当前执行入口）

依据 `docs/Agent层设计与实施分期.md`、`docs/Agent层首批实施计划.md` 与 plan 顶部增量方案。本批授权覆盖主干所需的 Agent、后端及 BFF 改动，替代历史“本批不推进 Agent”的执行限制；每块验证提交后仍按 AGENTS.md 等待人工审查，不自动推送部署。

- [x] G-01 可信身份解析：新增 GET /internal/agent/principal，同时校验服务凭证和用户 JWT；初版 70 项回归通过，评审修正后身份专项 19 passed，ruff 和 5 条分层契约通过。用户已审查通过，见 docs/审查记录/G-01可信身份解析/审查记录.md。
- [x] G-02 BFF → Agent → FastAPI 身份链路与工具权限上下文；新增用户检索入口、每请求客户端和工具表、可信只读身份上下文，接通默认任务客户端，修正 course_id 传参与映射。后端 41 项、Agent 62 项、BFF 16 项通过，相关 lint/类型/规则及分层通过。无迁移，已审查通过；证据见 docs/审查记录/G-02用户身份链路/审查记录.md。
- [x] G-03 PlanList、工具白名单和累计执行预算，复用并验证 G-02 已接通的只读检索与默认客户端；Agent 74 项通过，tsc/eslint 通过，无迁移，人工待审查，证据见 docs/Agent层验证记录/G-03.md。
- [x] G-03-C 文档草稿与风险扫描的只读上下文补齐：承接未提交改动，新增正文接口与工具、目标和父级可见性过滤、目标响应匹配与摘录来源标注；后端 72 项、Agent 相关 69 项通过，tsc/eslint/ruff 与 5 条分层契约通过。无迁移，用户已审查通过；见 docs/审查记录/G-03-C只读上下文/审查记录.md。
- [x] G-03-U 统一受控规划入口：聊天及四类生产任务统一接入模型 PlanList，去除固定任务计划与旧聊天工具循环的过渡差异；复用同一运行的白名单与预算，保留各任务来源约束。用户已通过 U2 审查，见 docs/审查记录/G-03-U2统一规划/审查记录.md；不代表 G-04/G-05 已完成。
  - [x] G-03-U1 执行基础：运行拥有累计预算，失败/异常不重置；逐步复核工具策略，401/403 立即停止，引用不读取原型属性。Agent 相关 8 文件 77 passed，tsc/eslint 通过；用户已审查通过，见 docs/审查记录/G-03-U1运行预算/审查记录.md。
  - [x] G-03-U2 聊天与四类任务共用模型规划入口，保留来源、任务目标范围和既有输出契约；相关 11 文件 102 passed，tsc/eslint 通过，用户已审查通过，见 docs/审查记录/G-03-U2统一规划/审查记录.md。
- [x] G-04 运行/计划/工具调用持久化，记录失败停止后续执行，按需增量迁移。用户已通过 B 审查；不代表 G-05/G-06 已完成。
  - [x] G-04-A 后端用户归属与双凭证写入契约：归属迁移、旧服务入口边界、运行状态和 trace 一致性、摘要脱敏；相关 116 passed，ruff 与 5 条分层契约通过，增量迁移隔离验证通过。用户已审查通过；见 docs/审查记录/G-04-A运行归属/审查记录.md。
  - [x] G-04-B 追加式计划/步骤契约、Agent 请求级异步记录器与审计失败阻断，移除生产内存单例；后端相关 88 passed、Agent 相关 119 passed，迁移/ruff/分层/tsc/eslint 通过，用户已审查通过。见 docs/审查记录/G-04-B持久审计/审查记录.md。
- [x] G-05 总结自检、有限返工、超时取消与明确终态。A/B 已审查通过，C 由用户 2026-10-23"继续自验开发"指令通过；真实联调证据归 G-06。
  - [x] G-05-A 模型异常结束校验：聊天流错误/异常结束不得发送 done，结构化输出异常结束不得返回成功或自动修复重试；失败终态审计与错误脱敏。相关 7 文件 93 passed，tsc/eslint 通过，用户已审查通过；见 docs/审查记录/G-05-A模型结束/审查记录.md。
  - [x] G-05-B 整体超时与取消传播、终态清理：模型/工具/后端单次 60 秒、运行累计 180 秒，取消不可降级，独立同凭证失败补写与 SSE 终态投递分别最多 5 秒。Agent 相关 13 文件 150 passed，tsc/eslint 通过，用户已审查通过；见 docs/审查记录/G-05-B超时取消/审查记录.md。
  - [x] G-05-C 来源检查、模型自检与累计有限返工：25 项专项，Agent 全部 17 文件 182 passed，tsc/eslint 通过。结构修复与重规划共用一次返工，工具/时间预算不重置，聊天候选通过检查后发送；验证记录见 docs/Agent层验证记录/G-05-C.md。
- [x] G-06 跨服务集成与批次收口（2026-10-23 实现验证完成，待人工验收）：新增 agent/tests/integration-run.test.ts 10 项，真实 app + 真实 internal-client 经 HTTP 访问本地 mock 后端，覆盖四类任务与聊天成功链路（双凭证、user 路径、蛇形审计事件、trace 透传）及 principal 401/403、工具撤权、审计创建/事件/终态失败错误分支；批次收口 Agent 192 passed + tsc/eslint、后端 439 passed + 20 skipped + ruff + 5 契约、前端 426 passed + eslint 全绿。真实模型联调、真实 MySQL 并发、进程崩溃恢复、三服务部署互通单列为限制；证据见 docs/Agent层验证记录/G-06.md。

## 知识树与教学周报（2026-10-23 用户需求，Q-09 定案，当前执行入口）

对应 spec KN-R01~03、US-21~23、E-14~19、X-07/08 与 plan 顶部增量方案。四项决策：粘贴大纲 AI 建树、差距=未覆盖主题+提问热力、系统每周自动生成、知识树师生可见而周报/教学计划教师私有。K 系列按序推进，每块验证提交后人工审查。

- [x] K-01 后端知识树与教学计划（2026-10-24 实现验证完成）：两张表迁移 k01_knowledge_tree 隔离库三段验证通过；BST 领域规则（sort_key 插入/中序/叶子删除/重复拒绝 E-15/E-16）；树读取登录可见、批量确认写入唯一入口（E-17）、教学计划 CRUD 与越权 403（E-14）；测试 8 项 + 课程回归共 27 passed。
- [x] K-02 后端周报与内部接口（2026-10-24 实现验证完成）：teacher_weekly_reports 迁移 k02_weekly_reports 三段验证、(course_id, week_start) 唯一幂等（E-18 409）；教师私有查询不因管理员旁路（404）；服务级内部接口四组（有树课程清单 E-19/树读取/近期问题软删隐藏排除/周报保存敏感词拦截）与用户级双凭证树读取；K-01 遗留 report_id 存在性校验接通；专项+回归 87 passed。
- [x] K-03 Agent 大纲分析任务（2026-10-24 实现验证完成）：knowledge_tree 任务 + fetchKnowledgeTree 工具（user 路径）+ 程序过滤重复建议（E-17 纯建议不写入）；普通故障降级、401/403 不降级；专项 7 项，Agent 全量 208 passed、tsc/eslint 零 error。
- [x] K-04 Agent 周报调度器（2026-10-24 实现验证完成）：每周定时 + 启动补偿（默认周一 08:00 可配）；服务级无主运行审计、数字全部程序聚合（剔除伪造引用）、409 幂等跳过、单课程失败隔离（X-07）、无树防御跳过（E-19）；专项 9 项，Agent 全量 208 passed。多实例重复触发随 T-18 收敛，单列限制。
- [x] K-05 前端（2026-10-24 实现验证完成）：教师端 teacher/courses/[id]/knowledge 三区块工作台（大纲分析→勾选确认建树、手动拓宽、教学计划、周报差距一键加入/拓宽）；学生端课程详情只读知识树区块；教师课程管理页入口；文案简体中文；新增测试 6 项，前端全量 68 文件 432 passed、eslint 零 error。
- [x] K-06 集成验证与收口（2026-10-24 完成）：三服务全量检查与文档回填（后端 453 passed + 20 skipped + ruff + 5 契约、Agent 208 passed + tsc/eslint、前端 432 passed + eslint；证据见 docs/Agent层验证记录/K-知识树与教学周报.md）。提交阻塞已解除：应 Mimosa 建议将 17 处既有测试 fixture 密码改为运行时随机生成（secrets/crypto.randomUUID，含脱敏测试键名改为黑名单单一事实源）、锚点解析等价重构后全量放行；分六笔提交 2749230～ad9d1c7（密码安全改造/需求方案/后端/Agent/前端/验证回填）。真实模型联调与多实例调度仍单列为限制。

## 执行说明

### PR27 审查修复专项（2026-10-09）

最新用户授权本清单全部完成后统一人工验收，覆盖前述逐块等待节点但不扩大其他实施范围。方案见 plan §6；完成勾选只表示实现验证，不表示人工批准。

- [x] R-01 回答分页、真实总数与跨页锚点定位：72文件411测试、lint零error、rules/build通过；点击主页链接的模拟导航后实际详情渲染第25条回答，另覆盖第401条及过期结果，人工待验收。
- [x] R-02 封禁/解禁独立持久审计、JWT 操作者与同事务回滚；本地测试库迁移到9f27b104c6de，权限、历史、幂等和故障测试通过。启用本地MySQL专项后全量308通过/9跳过，人工待验收。
- [x] R-03 更新用户名搜索、无限期封禁及通知限制文档，删除标签详情过期注释，保留热门内容/限时封禁未完成状态；专项spec/控件/接口说明及上游分析已同步，人工待验收。

1. 严格按 Phase 顺序执行，任务间有依赖不得跳序（T-02a 依赖 T-02；T-05 助教标记依赖 T-02a；T-03 依赖 T-02/T-02a）。
2. 本期实施边界：只做业务后端——T-02a 与 T-03~T-10 的后端部分及 pytest；Phase 3 全部任务与前端页面本期不启动。
3. 每完成一个任务打勾并简述结果；修改 spec/plan/tasks 后必须重跑 `/speckit.analyze` 才能继续 implement。
4. 执行中失败：修复或回改上游文档后重试，不跳过。
5. 第二阶段启动前：重读 spec v3 与 plan v3 的范围标注，重跑 analyze 后再 implement（届时补述前端与 Agent 任务）。
