# Tasks（build-frontend-mvp）

> 每个任务 = 一个板块：完成即跑 `npm run lint` + `npm test`，通过后按 `<type>: <简短中文描述>` 提交一次，并停下等待人工审查（用户小步快跑纪律）。
> 实现前先读对应设计文档章节；全部页面遵循 spec.md 的三态/权限/文案约束。

## Phase A：基建（共享控件 + 数据层）

- [x] A1 盘点并补全共享控件库（2026-10-06：15 控件 + 8 测试文件 46 用例，StatusBadge 扩展复用；commit bd5f86f）
  - 已有：ConfirmDialog / EmptyState / ErrorState / LoadingSkeleton / StatusBadge / TagChip / Toast / AiSuggestionCard
  - 按《页面控件级设计说明》§0.4 补齐：Button（primary/ghost/danger+loading）、Input、Textarea、Select、Card、Avatar、StateBadge（合并/强化 StatusBadge）、Pagination、TabNav、Modal、Drawer、MarkdownView（渲染前 XSS 清洗）、VoteWidget、UserLine（头像+昵称+角色徽标→用户主页）、FilterBar；AI 三态（生成中/失败重试/待人工确认）作为 AiSuggestionCard 状态位预留
  - 每个控件带 vitest；SubTask：逐控件实现 → 测试 → lint
- [x] A2 数据层：types 补全（2026-10-06：types 10 文件/api 11 域/hooks 2/utils/session-store；从 router.py 核对差异（无 DELETE /courses/{id}、读接口在 discovery 等）；新增 31 用例；commit 05c46b9）
  - hooks 测试 mock fetch；验证 BFF `x-trace-id` 注入链路

## Phase B：全局框架与守卫

- [ ] B1 三套 Shell 与守卫
  - StudentTopNav：Logo、4 页签（问题广场/课程/榜单/搜索记录）、搜索框 240px 回车→`/search?q=`、铃铛（未读数红点，仅登录）、用户菜单（个人中心/教师工作台/管理端按角色渲染/退出登录）、游客[登录]按钮；≤1024 折叠抽屉；AI 页签不渲染（TODO 注释）
  - TeacherShell：返回学生端 + 教师信息条；AdminShell：侧栏菜单 + Agent 运行项置灰"二期"；根 layout 字体栈/中文 lang
  - 守卫：middleware/layout 层未登录→`/auth/login?returnTo=`；`/teacher/**`（teacher/助教/管理员）、`/admin/**`（仅管理员）；`/403` 无权限页（不发业务请求）
- [ ] B2 认证页强化（已有 LoginForm/RegisterForm 基础上）
  - 登录：角色分流（教师→/teacher、管理员→/admin、学生→returnTo||`/`）、401 行内"账号或密码不正确"、loading
  - 注册：用户名 3~20 查重提示、邮箱校验、密码≥8 强度条、确认密码一致性、身份单选（学生/教师）、成功 Toast→登录页

## Phase C：学生端核心闭环

- [x] C1 问题广场 `/`（2026-10-06：QuestionBoard URL 驱动筛选、右栏真接口、timeAgo；接口缺口=列表无 excerpt/author_id、无 resolved 参数，留 TODO；commit 778e107）：筛选条（＋提问/课程 Select/标签多选/排序 Tab×状态 Tab，条件写 URL 可回填）、问题卡列表（整卡可点、标签 chip、投票/回答/浏览计数、UserLine）、右栏（热门榜 TOP5→用户主页+完整榜单入口、标签云×12、AI 助手卡槽位注释）、分页、三态
- [x] C2 课程列表与课程详情（2026-10-06：课程卡网格/头卡加入退出/四聚合/问答区；接口缺口=课程无 semester/status/member_count/teacher_id 字段、游客 401，已兜底；commit 8448842）
- [x] C3 发布问题 `/questions/new`（2026-10-06：QuestionForm 泛型复用+草稿 30s/恢复询问、TagPicker ≤5、标签两段式提交（发布收 int、新名走绑定接口，绑定失败不阻断）；commit 475a9f7）：标题 5~100 计数、Textarea+工具条+编辑/预览 Tab、课程 Select 可搜索预填、标签搜索添加 ≤5（重复 400 行内）、提交→详情+Toast、400 行内字段错误、500 保留草稿、localStorage 草稿 30s+恢复询问；右栏静态提示卡+AI 槽位注释
- [x] C4 问题详情 `/questions/[id]`（核心页，2026-10-06：QuestionDetailView+answers/comments 两 feature；采纳回包 {accepted,question_status}、作者判定用 me.username（接口无 author_id，留 TODO）；commit b48e814）：标题+状态徽标、UserLine+时间+浏览数、VoteWidget（可改票/取消，游客引导登录）、MarkdownView 正文+标签 chip、编辑/删除（仅作者或管理员）、写回答内联编辑器（被禁言 Toast 显示原因）、回答排序最新/得分、回答卡（采纳仅提问者/评论展开/二级回复缩进/评论删除作者或管理员/认证👑与推荐徽标条件渲染）、右栏提问者卡+相关问题（空则隐藏）+AI 槽位注释
- [x] C5 编辑问题 `/questions/[id]/edit`（2026-10-06：EditQuestionPanel 复用 QuestionForm + lockCourse/lockTags 锁定（后端 PATCH 仅收 title/body）、面包屑、删除 ConfirmDialog→广场、草稿状态行随 QuestionForm 全局生效；commit 07f54ed）：复用 C3 表单预填、面包屑、保存→详情/取消→详情/删除→ConfirmDialog→广场、草稿状态行

## Phase D：学生端其余页面

- [x] D1 标签详情 `/tags/[id]`、排行榜 `/rankings`（2026-10-06：复用 QuestionList；接口差异=无 GET /tags/{id} 与描述字段、rank 仅 user_id/username/score 三字段（其余"—"占位）、课程榜 URL 用 period=all&course_id（后端无 course 榜）；commit 1c21c4c）：周/月/课程 Tab+课程 Select、前三名徽标、行→用户主页、Tab 写 URL
- [x] D2 搜索记录页 `/search` + 用户主页 `/users/[id]`（2026-10-06：history 纯函数 ≤10 条置顶去重、URL 用 ?q= 兼容 keyword 别名；接口差异=用户主页三 Tab 无数据源（无 author 过滤参数）暂渲染"接口未开放"占位、声望周变动/采纳率无字段占位；commit db01bbc）：自动聚焦保留关键词、历史 chips localStorage≤10 逐条删/清空、结果复用问题卡+分页、空态引导提问、头卡大头像+声望摘要块、不出现隐私字段（测试含邮箱泄漏哨兵）
- [x] D3 个人中心 `/me` + 通知中心 `/notifications`（2026-10-06：MePanel 资料卡 PATCH 预填+loadMe 同步、ReputationLedger 前缀和倒推余额（后端无逐行 balance 字段，仅第 1 页精确）、快捷入口条件渲染；通知中心全部/未读 Tab+行点击已读跳转+全部已读；接口差异=UserUpdateRequest 仅收 bio/avatar_url（昵称改不了，载荷仍带）、通知类型实际为 answered/commented/accepted；commit 3967210）：资料卡编辑 PATCH、声望流水分页红+/绿-、快捷入口条件渲染：通知中心/我的 AI 记忆置灰/封禁申诉仅封禁态、全部/未读 Tab、行点击已读并跳来源锚点、全部已读、分页
- [x] D4 封禁申诉 `/appeals/new` + 操作结果页 `/action-result`（2026-10-06：理由 ≥30 字、501 兜底文案、未封禁 EmptyState；query 约定 type=success|error|info、title、message、return_to 仅收站内路径；接口差异=UserResponse 仅 status/ban_reason 无 banned_until、申诉约定 POST /api/appeals（501 兜底）；commit 59c1a4c）

## Phase E：教师端

- [ ] E1 教师工作台 `/teacher`（教师信息条、指标卡 2×2 可点导航、工单区 Tab 占位空态、动态调课空态）+ 我的课程 `/teacher/courses`（新建 Modal→POST、课程卡[管理]→详情）
- [ ] E2 课程管理详情 `/teacher/courses/[id]`（头卡编辑 Modal/跨端查看新标签/删除 danger；四 Tab：问题列表+隐藏入口/成员表+移出/标签列表+新建/设置状态开关；助教板块入口仅能力位用户渲染）
- [ ] E3 优质内容认证 `/teacher/certify`（课程 Select 仅本人任教、候选回答列表、认证/取消认证调已实现接口、无候选 EmptyState）+ 工单处理 `/teacher/moderation`（双栏版式骨架、501 兜底空态"接口随二期开放"）

## Phase F：管理端

- [ ] F1 治理总览 `/admin`（指标卡行×5、快捷入口卡、最近事件流骨架/空态）+ 用户管理 `/admin/users`（搜索+角色/状态筛选、用户表、封禁 Drawer（原因/说明/时长→POST ban）、解禁 ConfirmDialog→unban）
- [ ] F2 课程管理 `/admin/courses`（课程表+搜索+学期筛选、编辑 Modal 管理员任意课程）+ 审核队列/审批中心/申诉处理三页骨架（表格/双栏版式 + 501 兜底空态；审批中心按控件级说明 §4.5 版式预留七动作按钮区，接口 501 时不渲染动作组）

## Phase G：验收收尾

- [ ] G1 全站验收：逐页三态与权限可见性检查（五种角色）、搜索代码确认无直连 8000/8787、AI 暂缓项核对不渲染、URL 参数回填、returnTo 链路、禁言/封禁提示原因、文案全中文、无蓝紫渐变；lint+test 全绿；勾选 `specs/tasks.md` 前端相关项并在必要时回填 docs/接口文档差异（发现接口对不上→回填 plan §5+重跑 analyze 流程）

# Task Dependencies
- A1、A2 无前置依赖，可并行
- B1、B2 依赖 A1/A2；C/D/E/F 各页任务依赖 B1（Shell+守卫）与 A2（数据层）
- C2 依赖 A1（问题卡复用）；C4 依赖 A1（VoteWidget/MarkdownView）；C5 依赖 C3（表单复用）
- E3、F1、F2 依赖 B1；G1 依赖全部页面任务完成
- Phase C/D/E/F 内部无交叉依赖的任务可并行派发
