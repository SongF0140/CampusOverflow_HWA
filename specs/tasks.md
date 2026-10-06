# 任务清单（Tasks）

> 状态：v2（2026-09-20 联动 spec v3：①角色模型调整——助教不设独立角色，研究生助教认证通过后解锁助教板块，新增 T-02a 与 T-05 助教推荐标记（US-20、E-12、E-13、Q-07）；②范围调整——本期只做业务后端，Phase 3（T-11~T-17）整体标注第二阶段（Q-08））
> v3 修订（2026-10-06）：①一期 T-01~T-10 全部完成（pytest 236 通过 + ruff 零 error + lint-imports 5 契约全 KEPT）；②Phase 4 的 T-18/T-19/T-20 整体推迟至第三期部署阶段（用户决策）；③第二期启动，先实施基座 T-11 + T-12（Agent 服务骨架与单 Agent Loop、FastAPI 内部白名单接口与服务间鉴权）；④前端目录已移除（commit db64fb7），前端页面与 T-19/T-20 的界面条款随第三期恢复
> 命令：`/speckit.tasks` → 执行用 `/speckit.implement`（支持 `--continue` 续做）
> 验收标准：每个任务都有目标与完成判定，且可按顺序执行；过大的任务必须拆分。
> 完成后在 `- [ ]` 中打勾。
>
> **一期实施范围总注**：本期只做业务后端。Phase 1~2 为本期实施内容（后端模块与 pytest）；任务描述中涉及前端页面的部分随第二阶段前端实现一并验收；Phase 3 整体为第二阶段，本期不启动。
> **二期实施范围总注（2026-10-06 生效）**：第二期实施 Phase 3（Agent 服务与治理逻辑），当前批次 = T-11 + T-12 基座；T-13~T-17 随基座联调后逐项推进；Phase 4（T-18~T-20）推迟至第三期部署阶段；前端页面随第三期从 git 历史恢复（0ab1847）。

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

- [x] 【第二阶段】T-11 Agent 服务骨架与单 Agent Loop（C-05 基础）
  - 目标：Hono + Vercel AI SDK 跑通单 Agent Loop + task router；agent_run_id 生成；工具统一注册在 `agent/src/tools/registry.ts`
  - 完成判定：流式对话可演示；每次运行有唯一 agent_run_id；vitest 覆盖工具注册校验
  - 结果（2026-10-06）：commit b740af5。loop 用 streamText + stopWhen: isStepCount(n)（AI SDK 7 无 maxSteps），结构化输出 generateObject + Zod 自检重试一次；agent_run_id = crypto.randomUUID 每运行唯一；task router 四类任务分发（similar_questions/suggest_tags/moderation_scan/doc_draft）；检索工具经 registry 白名单注册，经 internal-client 调 /internal/agent/* 并透传 x-trace-id；POST /agent/chat SSE 流式可演示。vitest 35/35（mock 模型不依赖真实 LLM）+ eslint 零 error + tsc --noEmit 零错误。遗留：run 摘要内存记录（T-16 持久化）；moderation_scan 仅评估（审批随 T-15）；标签词表拉取随 T-13；MCP 随 T-17

- [x] 【第二阶段】T-12 内部白名单接口与服务间鉴权（C-05）
  - 目标：FastAPI `/internal/agent/*` 白名单接口（检索课程/问题/记忆读写/创建工单）；服务间 token 鉴权；跨服务调用携带 trace id
  - 完成判定：Agent 无任何直连数据库代码；未带凭证调用被拒绝；trace id 全链路传递
  - 结果（2026-10-06）：commit 3ae37e8。governance 扩展为 6 文件完整分层（domain/schemas/repository/service_internal/router_internal）；新增 agent_runs / tool_call_logs / agent_memory 三表（迁移 5d17479735ac 已 upgrade head）；/internal/agent/* 八接口按 plan §5 落地（memory 读/写、approvals 建工单、courses/questions 检索、runs 建/更新、tool-calls 记录）；服务间鉴权 X-Service-Token（未带/错误 401）+ X-Trace-Id 透传；记忆写入敏感词拦截拒绝；工单 source=agent 仅 pending 不处置（C-06）。pytest 244 passed + 9 skipped（原 236 无回归）+ ruff 零 error + lint-imports 5 契约全 KEPT。遗留：记忆删除/禁用接口归 T-14；处置动作归 T-15；agent_memory.course_id 为软引用无 FK

- [ ] 【第二阶段】T-13 智能标签推荐与相似问题推荐（US-11、US-12、E-09）
  - 目标：提交前推荐相似问题（含链接）；提交后推荐标签（含理由与置信度）；结果仅建议，用户确认后由后端写入
  - 完成判定：推荐不含站内依据时明确说明；未确认不写入；vitest mock 模型测试通过

- [ ] 【第二阶段】T-14 持久化记忆（US-17、C-07、X-06）
  - 目标：agent_memory 模块（用户偏好/课程上下文/任务经验三类）；Agent 经内部接口读写；敏感信息（密码/密钥/隐私原文）写入拦截；用户可删除或禁用影响自己的记忆
  - 完成判定：敏感内容写入被拒绝并留拦截日志；用户删除/禁用生效；pytest 覆盖读写权限

- [ ] 【第二阶段】T-15 内容风险预警与审批中心（US-13、US-14、US-16 申诉、Q-06）
  - 目标：静默检测新内容并按风险分级（低打标/中高建工单附快照与原因）；审批中心处理动作（忽略/修改/临时隐藏/软删除/警告/限时封禁/永久封禁）；封禁记录原因、期限、操作者、快照；申诉提交与复核
  - 完成判定：Agent 无法直接隐藏/删除/封号，只能创建工单；全部处置动作留审计记录；边界测试覆盖风险分级

- [ ] 【第二阶段】T-16 观测与审计（US-18、C-08）
  - 目标：agent run / tool call / approval request 记录 trace id、agent_run_id、调用摘要；管理员可查看运行记录与失败原因；记录可互相关联
  - 完成判定：按 trace id 可检索完整调用链；失败运行可定位原因

- [ ] 【第二阶段】T-17 MCP Adapter 白名单接入（US-19）
  - 目标：用 mock MCP 工具验证 `agent/src/mcp/`（client/registry/policy/adapter）的白名单、策略和日志；再接真实 MCP Server 配置（名称/用途/启用状态/权限范围）；调用记录参数与结果摘要；涉文件/外部网络/发布/审核的工具必须人工确认
  - 完成判定：未注册工具不可被调用；MCP 调用失败不影响核心问答；MCP 不能直改核心业务表

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

## 执行说明

1. 严格按 Phase 顺序执行，任务间有依赖不得跳序（T-02a 依赖 T-02；T-05 助教标记依赖 T-02a；T-03 依赖 T-02/T-02a）。
2. 本期实施边界：只做业务后端——T-02a 与 T-03~T-10 的后端部分及 pytest；Phase 3 全部任务与前端页面本期不启动。
3. 每完成一个任务打勾并简述结果；修改 spec/plan/tasks 后必须重跑 `/speckit.analyze` 才能继续 implement。
4. 执行中失败：修复或回改上游文档后重试，不跳过。
5. 第二阶段启动前：重读 spec v3 与 plan v3 的范围标注，重跑 analyze 后再 implement（届时补述前端与 Agent 任务）。
