# 前端 MVP 实现 Spec（build-frontend-mvp）

## Why
后端一期（T-01~T-10，242 项 pytest）已完成，前端骨架仅有 BFF、设计 token、少量组件与登录/注册页，其余路由均为 `.gitkeep` 占位。需要按 `docs/前端架构/` 四份文档（页面版式与页面连接说明、页面控件级设计说明、设计系统、前端服务需求文档）把前端页面补齐到可演示的 MVP。

## What Changes
- 新增学生端 15 页、教师端 5 页、管理端 8 页的页面实现（替换 `.gitkeep` 占位）。
- 补全全局共享控件库（`src/shared/components`，按控件级设计说明 §0.4 清单）与数据层（types / api 封装 / hooks）。
- 实现三套 Shell（StudentTopNav / TeacherShell / AdminShell）+ 路由守卫（returnTo、403 无权限页）。
- 执行 2026-10-06 定案：**AI 页面全部暂缓**（不渲染、留注释槽位）；补录 `/search` 搜索记录页与 `/action-result` 操作结果页。
- 治理类接口（审核队列 / 审批中心 / 申诉，后端 501 占位）对应页面做骨架 + 501 兜底空态，不阻塞其余页面。
- vitest 覆盖 hooks 与关键交互；`npm run lint` / `npm test` 零 error。

## Impact
- 依据文档：`docs/前端架构/`（4 份）、`docs/前端后端接口对照表.md`（D1~D16 定案）、`specs/plan.md` §2/§5、`docs/后端架构/` 三端接口文档（接口字段权威）。
- 影响代码：仅 `campus-overflow-ai/backend` 之外的 `campus-overflow-ai/frontend/**`；不改后端接口，不改 specs/ 上游文档（差异若发现接口对不上，按"回填 plan.md §5 + 对应接口文档 + 重跑 analyze"流程处理，不在前端私自适配）。
- 实现技能：frontend-ui-engineering、ui-ux-pro-max（设计系统已定稿，仅作核对）、writing-plans。

## ADDED Requirements

### Requirement: 三端布局与路由守卫
系统 SHALL 提供学生端（`/` 顶栏+右栏）、教师端（`/teacher` 顶栏信息条）、管理端（`/admin` 侧栏+顶栏）三套 Shell；未登录访问受保护页 SHALL 跳 `/auth/login?returnTo=<原路径>`，登录后回原页；角色不匹配 SHALL 渲染无权限页且**不发起业务请求**；越权入口（按钮/菜单）SHALL 不渲染。

#### Scenario: 学生访问 /admin
- **WHEN** student 角色用户直接访问 `/admin/users`
- **THEN** 渲染 403 无权限页，页面不发任何 `/api/backend` 业务请求

#### Scenario: 游客点"＋提问"
- **WHEN** 未登录用户点击问题广场"＋提问"
- **THEN** 跳转 `/auth/login?returnTo=/questions/new`，登录成功后回到发布问题页

### Requirement: BFF 请求层与统一错误处理
所有请求 SHALL 经同源 BFF（`/api/backend/api/**`、`/api/agent/**`）；代码中 SHALL NOT 出现直连 `:8000` / `:8787` 的地址；统一处理 `{ code, data, message }` 与错误码：400 行内提示、401 跳登录（带 returnTo）、403 无权限提示、404 内容不存在、500 中文提示+重试且**保留表单草稿**。

#### Scenario: 500 保留草稿
- **WHEN** 发布问题提交返回 500
- **THEN** 表单内容不丢失，展示"服务开小差了，请稍后重试"，草稿仍可恢复

### Requirement: 设计系统与共享控件库
全局样式 SHALL 采用 `设计系统.md` v1.1 的 token（青绿强调色、中性底、语义三档色、圆角 4/8/12、动效规范 + reduced-motion 降级）；控件按控件级设计说明 §0.4 清单沉淀到 `src/shared/components`；所有列表/详情 SHALL 具备加载（骨架屏）/空（EmptyState）/错误（ErrorState）三态；状态 SHALL"色块+文字"表达；danger 操作 SHALL 配 ConfirmDialog。

#### Scenario: 问题广场三态
- **WHEN** 依次模拟接口加载中 / 返回空列表 / 返回 500
- **THEN** 分别渲染卡片骨架×5、"还没有问题，来提第一个 [＋提问]"、中文错误+[重试]

### Requirement: 认证
登录页 SHALL 支持账号（邮箱/用户名）+密码、行内错误、登录后按角色分流（学生→returnTo 或 `/`，教师→`/teacher`，管理员→`/admin`）；注册页 SHALL 支持用户名查重提示、邮箱校验、密码强度条、确认密码一致性、身份单选（学生/教师）；退出登录 SHALL 清除登录态并回广场。

### Requirement: 问题闭环（学生端核心）
问题广场 SHALL 提供课程/标签筛选、排序（最新/热门/未解决）×状态（全部/未解决/已解决）组合，条件写入 URL 可回填；发布问题 SHALL 支持标题 5~100 字计数、Markdown 编辑/预览切换、课程选择（支持 `?course_id` 预填）、标签手动搜索添加（≤5，重复 400 行内提示）、草稿 localStorage 30s 自动保存+恢复询问；问题详情 SHALL 支持投票（可改票/取消）、回答（最新/得分排序）、评论（二级回复缩进）、采纳（仅提问者，成功后状态徽标联动"已解决"）、教师认证/助教推荐徽标；编辑/删除入口 SHALL 仅对作者或管理员渲染。

#### Scenario: 采纳闭环
- **WHEN** 提问者点击某回答"采纳"并确认
- **THEN** 该回答显示采纳徽标，问题徽标变"已解决"，回答作者收到 +15 声誉（后端联动），按钮消失

#### Scenario: 越权不渲染
- **WHEN** 非提问者浏览问题详情
- **THEN** 不出现任何回答的"采纳"按钮；非作者不出现"编辑/删除"

### Requirement: 课程
课程列表 SHALL 提供学期筛选+搜索；课程详情 SHALL 展示课程头卡（加入/退出/进入问答区）、四聚合区块数据（hot/frequent/tags/active_users，T-09 已实现）、课程问答区（最新/热门 Tab，复用问题卡）；我要提问 SHALL 预填课程。

### Requirement: 发现（搜索/标签/排行榜/相关问题）
顶栏搜索框回车 SHALL 跳 `/search?q=`；搜索页 SHALL 含搜索历史 chips（localStorage 最近 10 条，可逐条删/清空）与结果列表（复用问题卡+分页）；标签详情页 SHALL 展示标签头卡+该标签问题列表；排行榜 SHALL 支持周榜/月榜/课程榜页内 Tab（课程榜含课程 Select），行点击→用户主页；问题详情右栏 SHALL 展示相关问题（`/api/questions/{id}/related`，空则隐藏整块）。

### Requirement: 用户域
用户主页 SHALL 仅展示公开信息（无邮箱/手机号），含声望摘要块（当前声望/周变动/采纳率）与 TA 的提问/回答 Tab；个人中心 SHALL 支持资料编辑（PATCH /api/users/me）与声望流水分页；封禁态用户 SHALL 在个人中心看到"封禁申诉"入口。

### Requirement: 通知中心
通知中心 SHALL 支持全部/未读 Tab、未读红点（顶栏铃铛>99 显示 99+）、单条点击标记已读并跳来源页（问题详情锚点）、全部已读；三态齐全。

### Requirement: 教师端
教师工作台 SHALL 展示教师信息条+指标卡（无可用的接口数据源时显示"—"或 0，不调用未实现接口）；我的课程 SHALL 支持新建/编辑课程（Modal 表单→POST/PATCH /api/courses）；课程管理详情 SHALL 含问题/成员/标签/设置四 Tab、跨端查看（新标签打开 `/courses/[id]`）、删除课程（danger+确认）；优质内容认证页 SHALL 基于已实现 certify 接口提供认证/取消；工单处理页 SHALL 为骨架版（治理接口 501，展示空态"接口随二期开放"）。助教板块入口 SHALL 仅对具备助教能力位的用户渲染。

### Requirement: 管理端
治理总览 SHALL 展示指标卡行+快捷入口+最近事件流（无接口的数据源以骨架/空态呈现，不报错）；用户管理 SHALL 支持用户名搜索+角色/状态服务端组合筛选，当前不支持 ID 搜索；封禁 SHALL 说明无限期直至人工解禁，不提供未实现的期限选项；封禁/解禁 SHALL 保留操作者、时间、前后状态和原因历史，失败不出现部分成功，重复成功操作也留记录；解禁 SHALL 确认且不承诺未实现的通知；课程管理 SHALL 列出全部课程并支持编辑（管理员任意课程）；审核队列/审批中心/申诉处理 SHALL 为骨架版 + 501 兜底空态；Agent 运行入口 SHALL 置灰"二期"。限时封禁、证据快照、申诉与审计查看界面保持后续范围。

### Requirement: AI 暂缓与骨架预留
以下 SHALL NOT 渲染且留代码注释槽位：顶栏 AI 页签、问题广场 AI 助手卡、发布问题相似问题推荐、问题详情 AI 辅助回答、`/me/memories` 页面（入口置灰+tooltip）、`/admin/agent/**` 页面（侧栏 disabled+"二期"角标）；主流程（提问/回答/投票/采纳/评论）SHALL NOT 依赖任何 AI 组件；标签推荐为纯手动，不调用 Agent 接口。

### Requirement: 补录页面
`/search` 搜索记录页（顶栏第 4 页签）与 `/action-result` 操作结果页（居中结果卡：图标+标题+摘要+[继续提问]+[返回来源页]）SHALL 实现；成功/失败由跳转方通过 query 传入。

### Requirement: 申诉
封禁申诉页 `/appeals/new` SHALL 回显封禁原因与时间，申诉理由 ≥30 字计数；未封禁用户访问 SHALL 显示 EmptyState；提交 `POST /api/appeals`（二期接口）返回 501 时 SHALL 提示"接口尚未开放"而非报错堆栈。

### Requirement: 非功能与验收门禁
界面文案 SHALL 全简体中文；SHALL NOT 出现大面积蓝紫渐变/"AI 产品模板感"；正文行宽约 72 字符；桌面优先（1440/1600/1920），≤1024 主导航折叠抽屉、右栏下沉；动效 SHALL 支持 `prefers-reduced-motion`；`npm run lint` 与 `npm test` SHALL 零 error；vitest SHALL 覆盖数据 hooks、表单校验、投票/采纳等关键交互（mock BFF，不依赖真实后端网络）。

## REMOVED Requirements
（无）
