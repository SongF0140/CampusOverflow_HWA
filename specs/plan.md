# 技术方案（Plan）

> 状态：v3.1（2026-10-10 状态回填：一期 T-01~T-10、二期 T-11~T-13 及前端 F-C1~F-C5 已落地；不改变 spec v3 的需求范围）
> 命令：`/speckit.plan`
> 铁律：方案必须能完整覆盖 spec.md 的核心需求，逐条映射。
> 本文件是 spec 的 HOW 层：技术选型、数据模型、接口草案、目录设计。

## 1. 需求覆盖映射

> 对应 spec.md v3（US-02~US-20）；状态列按 2026-10-10 的代码与 tasks 勾选回填。

| spec 需求 | 本方案覆盖模块 | 状态 |
| --------- | -------------- | ---- |
| US-02 注册登录 | frontend: auth 域；backend: users 模块（JWT + bcrypt） | 已覆盖 |
| US-03~05 提问 / 回答 / 评论 | frontend: questions 域；backend: questions / answers / comments 模块 | 已覆盖 |
| US-06~08 采纳 / 投票 / 声誉 | backend: qa（内容与采纳状态）+ interaction（组合编排、投票、积分流水与窗口/课程榜）+ identity（总分及累计总榜） | T-08 已完成；专用 MySQL 并发专项随部署补验 |
| US-09 搜索筛选 | backend: discovery（纯读组合）+ qa（问题查询）+ interaction（本人票态）；frontend 二期 | T-09 已完成；前端部分筛选受现有接口字段限制 |
| US-10 课程与课程问答区 | backend: courses（基础读写）+ discovery（课程聚合视图）；frontend 二期 | T-03/T-09 已完成，课程聚合已落地 |
| US-11~12 标签 / 相似问题推荐 | agent: 单 Agent Loop + task handler + tools；backend: /internal/agent/* 检索接口 | T-13 已完成，前端 AI 页面仍暂缓 |
| US-13~14 风险预警 / 工单处理 | agent: 单 Agent Loop 的 moderation task handler + approvals；backend: approvals / moderation 模块 | 第二阶段（governance 表与占位第一阶段已建） |
| US-15 通知 | backend: interaction（回答/评论/采纳通知）；frontend 通知中心二期；治理通知随治理二期 | 互动通知与前端通知中心已落地；治理通知待 T-15 |
| US-16 封禁与申诉 | backend: users（封禁）+ appeals；frontend: admin 域 | 封禁已覆盖（T-02 完成）；申诉第二阶段 |
| US-17 持久化记忆 | backend: agent_memory 模块；agent: src/memory/（经内部接口读写） | 第二阶段 |
| US-18 运行可追踪 | agent: src/observability/；backend: observability 模块 | 第二阶段 |
| US-19 MCP 白名单（P2） | agent: src/mcp/；backend: mcp_servers 配置表 | 待第二阶段 |
| US-20 研究生助教板块 | backend: identity（研究生身份与助教认证字段 + require_graduate_assistant）+ qa（助教推荐标记）；frontend: 学生端申请/推荐入口与教师审核 | 后端 T-02a/T-05、前端 F-C5 已落地 |

## 2. 技术选型

| 层次 | 选型 | 理由 | 约束符合性（对照宪法） |
| ---- | ---- | ---- | ---------------------- |
| 前端 | Next.js 16（App Router）+ React 19 + TypeScript 5 + Tailwind CSS 4 + @ai-sdk/react | App Router 文件路由 + BFF；useChat 消费 Agent 流式输出 | C-01/C-02/C-04 |
| 业务后端 | FastAPI + SQLAlchemy 2.x（同步 + PyMySQL）+ Alembic + Pydantic + PyJWT + bcrypt | 同步模式简单可靠；Python ≥ 3.11 | C-02/C-05 |
| Agent 服务 | TypeScript 5 + Vercel AI SDK + Hono + Zod + @modelcontextprotocol/sdk | 支持 agent loop、tool calling、streaming、structured output、MCP Adapter；Node ≥ 22 且 ESM | C-05/C-06/C-07/C-08 |
| 状态管理 | 组件内 state + fetch hooks + Zustand（必要时） | 简单状态不上全局 store | C-02 |
| 数据存储 | MySQL（唯一持久层）+ Redis（可选依赖组，第一阶段不装） | Agent 记忆/审批工单/观测数据统一入库 | C-05/C-07 |
| 测试 | pytest（后端）、vitest（前端/Agent） | 与工具链原生集成 | C-03 |

依赖明细与版本约束见 [docs/依赖说明.md](../docs/依赖说明.md)。

## 3. 架构设计

三服务物理分离，Agent 不直连数据库，所有数据访问走 FastAPI 白名单接口。第一阶段采用单 Agent Loop + task router，不实现真实多 Agent 协作；`agent/src/agents/` 仅保留为第二阶段角色化扩展点。

> 2026-10-10 状态回填：后端采用 docs/后端架构说明.md 的轻量模块化单体（6 模块、4.5 层 + core）；Agent 服务与 `/internal/agent/*` 已随 T-11/T-12 落地，T-13 推荐任务已完成。下文未落地的记忆、治理、观测和 MCP 设计分别归 T-14~T-17。

```mermaid
graph TD
    FE[前端 Next.js<br/>src/app + src/features] -->|/api/agent 流式| AG[Agent 服务 Hono<br/>Agent Loop + MCP Adapter]
    FE -->|/api/backend BFF| BE[业务后端 FastAPI<br/>modules/{models,schemas,service,router}]
    AG -->|/internal/agent/* 白名单| BE
    AG -.->|MCP 白名单工具| MCP[MCP Server]
    BE --> DB[(MySQL)]
```

- Agent 的 run / tool call / approval 记录 trace id、agent_run_id 与调用摘要（C-08）。
- 高风险动作由 Agent 生成待确认工单，人工确认后由后端执行（C-06/C-07 配套）。
- MCP Adapter 第一阶段只接 mock MCP 工具，验证白名单、策略、日志和审批链路；真实外部 MCP Server 放第二阶段。
- Observability 第一阶段先实现 trace id 字段透传和数据库日志；完整 OTLP exporter 放第二阶段。

### T-08 单向编排目标与验收边界（2026-10-03）

- 目标依赖为 `interaction → qa/identity`、`qa → identity/courses`，禁止 `qa → interaction`；工作区已完成本地源码解耦、四个组合入口迁移及完整异常回滚包围，并增加方向契约。本地源码整改不等于人工审查通过或真实 MySQL 验收，T-08 不勾选。
- QA 保有投票目标读取、票分更新/读取、公开内容计数和采纳状态的数据所有权，通过 service 公开函数输出内部 schemas；identity 保有用户总分及累计总榜，interaction 保有投票与流水、窗口/课程榜和组合编排（D-2/D-5）。
- `GET /api/questions`、`GET /api/questions/{id}`、`GET /api/questions/{id}/answers`、`POST /api/answers/{id}/accept` 目标迁移至 interaction router/service 编排；外部 URL、鉴权、蛇形字段及统一响应不变，router 只调本模块 service。
- 共享 Session，参与函数只 flush；最外层 service 用例负责提交及失败回滚（D-7/D-8）。通知随 T-10，不提前实现。后续按四步计划逐块审查，不引入 UoW、事件总线或新依赖。
- 榜单采用数据库查询：全站 all 读取 identity 总分（含零分用户），week/month 聚合滚动 7/30 天流水，课程按流水快照；score 降序、user_id 升序，最多 10 名存在的用户。工作区已采用每批最多100候选的 keyset 装配；不证明聚合扫描成本有界。真实 MySQL 并发与性能证据仍缺失，SQLite 通过不能替代行锁/隔离证据。

### T-09/T-10 最小差异设计（待人工批准，2026-10-03）

本节仅供审查，不授权实现。既有依据为 US-09/US-10/US-15、需求 §4.2/§4.8/§4.9、E-10/E-11、Q-08 和分层基线 D-2/D-5/D-7/D-8；本轮指定的时间边界、通知本人范围/全局未读/幂等/去重/原子性作为设计约束。下述新增产品口径均为推荐，未获人工批准；不得将其记为已关闭澄清。

#### T-09：共用查询、相关问题与课程视图

- discovery 保留 router/service/schemas 三文件纯读结构，无表、repository 或 domain；router 只调用 discovery.service。优先经公开 service 组合，不使用包注释中的直接 ORM 读取捷径，不放宽 D-2/D-5。依赖为 discovery → courses/qa/interaction/identity，其他模块不得反向依赖 discovery。
- `/api/search` 的 `q` 映射既有问题查询的 keyword；discovery 调 interaction 的列表组合能力，向下复用 QA service/repository，保留真实 `my_vote`。`/api/questions` 保留 keyword 名称并增加同一时间过滤；所有筛选 AND 组合，标题/正文匹配为 OR，count 与分页使用相同过滤。热门直接使用 `sort=hot`，不加独立热度模型或接口。
- `created_from` 包含、`created_before` 排除，允许单侧；接收带 Z 或明确偏移的 ISO 8601，归一 UTC，双侧须 from < before；非法格式、无时区或相等/倒置范围 → 400。现有数据库 DateTime + now() 不足以证明历史时间为 UTC：实施前核验测试部署时区及历史写入口径，确认后才将 UTC 边界转为 naive UTC 比较；不盲目转换历史数据。此为实施阻塞，不能靠设计假定已解决。
- 推荐待批：q 去首尾空白后1～100字，空白拒绝400；关键词按普通文本包含匹配，转义 `%`、`_` 和转义符，问题列表 keyword 同步一致，不增加全文引擎。分页沿用 page=1、page_size=20（1～100）。latest 为 created_at DESC/id DESC，hot 为 vote_score DESC/created_at DESC/id DESC。
- 推荐待批路径 `GET /api/questions/{id}/related`：QA 提供无浏览计数副作用的标签候选公开读能力，repository 内按共有标签数 DESC、vote_score DESC、created_at DESC、id DESC 去重排序并 limit10；候选跨课程，不附加未获需求支持的同课程限制。源问题不存在/软删 → 404；源无标签或无候选 → 空 items；排除自身、软删及零交集。discovery 批量补本人票态，返回既有问题卡片，不做 AI 或额外相关分数字段。
- US-10 课程四聚合及列表 question_count 是明确一期要求，当前空数组/0不算交付；纳入 T-09 补交（T-03/T-07 遗留）。GET `/api/courses`、`/api/courses/{id}` 的只读视图入口迁入 discovery；新增 `/api/courses/{id}/questions`，课程写路由留 courses，移除旧 GET 注册避免重复。外部基础字段/登录权限/joined及统一响应保持。
- courses 公开基础分页/详情；QA 公开批量课程问题计数、课程标签及参与候选 schemas，查询仍在 QA repository；discovery 组合，不让 courses → qa。课程列表只对当前页 course_ids 批量计数，详情按 course_id 聚合、数据库排序限额，禁止拉全表在 Python 排序或逐条查用户名/票态。
- 推荐待批四聚合精确口径：hot_questions 与 frequent_questions 均复用本课程 hot 前10问题卡片（“高频”不表示重复提问频次，无历史频次模型）；tags 为 `{id,name,type,question_count}`，可见课程问题绑定数 DESC/id ASC，前10；active_users 为 `{user_id,username,activity_count}`，累计可见课程问题数 + 可见回答数，回答须归属可见本课程问题，不计评论/投票/积分、不限定角色或成员，次数 DESC/user_id ASC，最多10名存在用户；identity 批量补用户名、缺用户补后续候选。无数据返回空数组及真实0。

#### T-10：interaction 通知与写组合

- 仅被回答、被评论、被采纳三类一期通知；审核结果/待审核工单属于治理二期，T-10 原任务治理措辞按 Q-08 范围解释，不提前实现。
- interaction 承载 POST `/api/questions/{id}/answers`、`/api/questions/{id}/comments`、`/api/answers/{id}/comments`，移除 QA 对应写路由注册；编辑/删除及评论读路由不搬迁。鉴权、截断提示、错误顺序、响应字段与已有权限保持，回答评论仍仅校验回答自身软删，不借机改变 E-10。
- QA 的 publish_answer/publish_comment 拆为 prepare 能力，仅 flush，无 commit；返回内部 Pydantic 快照：已创建 answer/comment 响应及 truncated、question_id、target_type/target_id、target_author_id、parent_author_id（可空）。回答写快照含 question_author_id；采纳 AcceptedAnswerData 保留 answer_id/author_id/course_id 并补 question_id。快照由已校验上下文生成，不调用会加浏览数的详情，不返回 ORM，不读取原正文用于通知。
- interaction 最外层 service 用同一 Session，在 try 内依次 prepare → 收件人集合去重/剔除操作者 → 通知 flush → commit；失败统一 rollback 并原样传播。采纳为 prepare → 回答者+15总分/流水 → accepted通知 → commit，任何写/读/commit失败全部回滚。禁止 commit 后补通知、独立 Session、事件总线/UoW或新依赖；TODO(agent)仍仅注释。
- 被回答给提问者，被采纳给回答者；顶级评论给问题/回答作者，回复给目标作者与父评论作者，去重并排除操作者。自采纳积分政策保持+15，但不通知自己；编辑/删除/读接口不触发新通知。事件内去重不等于跨 HTTP 重试幂等，不新增未授权的请求幂等系统。
- Notification 属 interaction：表 notifications；id Integer PK，recipient_id Integer NOT NULL FK users.id（不级联删用户），type String(20) NOT NULL（answered/commented/accepted），title String(100) NOT NULL，link String(255) NOT NULL，is_read Boolean NOT NULL（应用及服务端默认false），created_at DateTime NOT NULL（UTC生成，与时间口径核验联动）。无历史通知回填，不保存正文、邮箱、隐私快照；repository只 flush、schema出参。
- 必需复合索引 `(recipient_id, created_at, id)` 支撑本人列表；`(recipient_id, is_read, created_at, id)` 支撑未读筛选及计数。查询均绑定 JWT recipient_id，列表 created_at DESC/id DESC；unread_count 独立统计本人全部未读，不受分页/unread_only影响。单条 UPDATE 同时过滤 id/recipient_id/is_read=false；已读本人仍成功，非本人或不存在404；read-all只更新本人未读，重复成功。更新及返回计数同一外层事务；响应是该请求读取时计数，不保证并发到达后仍不变。
- 推荐待批通知文案为固定纯文本“你的问题收到新回答”“你的内容收到新评论”“你的回答被采纳”；安全 link 仅由已验证整数生成 `/questions/{question_id}#answer-{answer_id}` 或 `#comment-{comment_id}`，不接收客户端URL/HTML，前端锚点支持二期确认。内容软删后通知保留，点击遵循既有404权限，不暴露正文。
- Alembic新增独立增量revision，当前文件链head为 ac5af405a45e，实施时重新核对单head再设 down_revision；仅建 notifications/FK/索引，不改旧票/流水/QA表，不用运行时create_all、不触碰生产数据。审阅离线 upgrade SQL；本轮不创建迁移或连库。获授权后在专用MySQL测试库验 upgrade/current、字段默认/索引/FK及事务；MySQL DDL非事务性，失败检查残留再处理，不假定可自动回滚。downgrade只删新增表（索引随表删，避免FK索引错误），会丢通知，应先停止相关写入并备份，禁止默认在生产降级。

#### 批准门槛、验证与剩余缺口

- 推荐复用查询/同步同事务通知；不选独立搜索引擎、复杂推荐、异步通知，因为超出最小需求且扩大一致性成本。所有上述产品推荐、路由所有权迁移及新内部契约须人工审查；本节不是已批准实施计划。
- T-09未来测试：q标题/正文及字面通配符、全部组合、UTC半开边界/偏移/非法范围、count同过滤/同时间稳定分页、热门复用、相关去重与软删/自身排除/空集/限10/无浏览副作用/真实票态；课程计数和四聚合、空课程、缺用户、无N+1和无环。
- T-10未来测试：三类触发、同人去重/自通知抑制、本人范围/越权404、筛选空页仍全局未读、重复read/read-all、写/通知/积分/commit故障整体回滚、旧问答外部契约及分层契约；专用MySQL另验迁移/并发，不把SQLite当MySQL证据。
- 阻塞/待确认：历史时间及部署UTC口径；课程活跃统计窗口与“高频”复用hot的产品批准；相关跨课程/排序/路径、关键词限制与字面匹配、通知文案/锚点与删除后保留策略；任务拆分和教师端共享GET契约需在批准后同步，重新analyze再进入实现。T-08真实MySQL缺口不因本设计消失，T-08/T-09/T-10全部保持未勾选。

## 4. 数据模型

完整字段见 docs/后端架构说明.md 的数据模型章节；本节保留关键实体关系，作为实现入口。

> 2026-09-20：agent_memory / approvals / observability 为第二阶段模块；第一阶段仅建 governance 表（ModerationCase/Appeal），并在 users 增加研究生身份类型与助教认证状态字段。
> 2026-09-30 T-02a 字段定案：`users.identity_type`（undergraduate/postgraduate，默认 undergraduate）、`users.assistant_cert_status`（none/pending/approved/rejected，默认 none）、`assistant_cert_applied_at`、`assistant_cert_reviewed_by`、`assistant_cert_reviewed_at`；能力位判定 = student 角色 + postgraduate + approved（`identity/domain.is_graduate_assistant`）。

```typescript
interface Question {
  id: string;
  courseId: string;
  authorId: string;
  title: string;
  body: string; // Markdown，渲染前需 XSS 清洗
  status: "open" | "resolved" | "closed" | "hidden" | "deleted";
  acceptedAnswerId: string | null;
  createdAt: Date;
}

interface AgentRun {
  id: string;
  taskType: "suggest_tags" | "similar_questions" | "moderation_scan" | "doc_draft";
  status: "running" | "succeeded" | "failed" | "needs_approval";
  traceId: string;
  inputSummary: string;
  outputSummary: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

interface ApprovalRequest {
  id: string;
  agentRunId: string;
  actionType: "hide_content" | "delete_content" | "ban_user" | "write_file" | "call_mcp_tool";
  riskLevel: "low" | "medium" | "high" | "critical";
  status: "pending" | "approved" | "rejected" | "expired";
  reason: string;
  createdAt: Date;
}
```

后端二期新增（对应 docs/后端架构说明.md 第 8 节演进路径）：`agent_memory` 相关表与内部接口（持久化记忆）、`governance` 审批逻辑（审批工单）、`observability` trace/运行日志（trace id 字段已随 governance 模型预留）。

## 5. 接口/内部 API 草案

> 2026-10-10：下表 `/internal/agent/*` 基础接口已随 T-12/T-13 注册；记忆删除/禁用、治理处置、管理端观测与 MCP 相关扩展仍归 T-14~T-17。

**一期已落地（T-02a，2026-09-30 定案，细节见 docs/后端架构/教师端与学生端接口文档）**：

| 接口 | 权限 | 说明 |
| ---- | ---- | ---- |
| POST /api/users/me/assistant-certification/apply | 登录学生 | 申请助教认证：声明研究生身份并置 pending；非学生 / pending / approved → 400 |
| GET /api/users/assistant-certifications | 教师 | 按 status（pending/approved/rejected）分页查看申请列表，不含隐私字段 |
| POST /api/users/{id}/assistant-certification/review | 教师 | `{action: approve\|reject, comment?}`；approve 置位能力位；目标非研究生或非 pending → 400；写审计日志 |

| 名称 | 签名 | 说明 | 对应 spec |
| ---- | ---- | ---- | --------- |
| GET /internal/agent/memory | (`user_id`, `task_type`, `course_id?`) => MemoryItem[] | Agent 读取相关记忆，后端按用户、课程、任务类型做权限过滤 | US-17 / C-07 |
| POST /internal/agent/memory | (`user_id`, `memory_type`, `content`, `source_run_id`) => MemoryItem | 写入记忆，后端做敏感信息过滤与审计记录 | US-17 / C-07 / X-06 |
| POST /internal/agent/approvals | (`action_type`, `risk_level`, `payload_snapshot`, `trace_id`) => ApprovalRequest | 高风险动作生成待确认工单，不直接执行删帖/封禁/写文件 | US-13 / US-14 / US-16 / C-06 |
| GET /internal/agent/courses/search | (`keyword`, `limit`) => Course[] | 站内课程检索工具，用于回答课程上下文相关问题 | US-10 / US-12 |
| GET /internal/agent/questions/search | (`keyword`, `course_id?`, `tags?`, `limit`) => Question[] | 相似问题候选检索，Agent 只负责排序、解释与结构化建议 | US-09 / US-12 |
| GET /internal/agent/tags | (limit?) => Tag[] | 站内标签词表，标签推荐候选集 | US-11 / E-09 |
| POST /internal/agent/runs | (`task_type`, `trace_id`, `input_summary`) => AgentRun | 创建 Agent 运行记录 | US-18 / C-08 |
| PATCH /internal/agent/runs/{agent_run_id} | (`status`, `output_summary?`, `error_summary?`) => AgentRun | 更新 Agent 运行结果，便于管理员追踪失败原因 | US-18 / C-08 |
| POST /internal/agent/tool-calls | (`agent_run_id`, `tool_name`, `args_summary`, `result_summary`, `status`) => ToolCallLog | 记录工具调用摘要，不落原始密钥和隐私原文 | US-18 / C-08 |

完整路径规划见 docs/后端架构/Agent端预留文档.md（二期接口权威清单）。

### PR27 正式业务契约与前端补完（2026-10-09）

用户授权完整 PR27 本地合并后补完前端；方案与边界详见 `docs/前端补完计划.md`，任务为前端专项 F-C1～F-C6。以下均为已存在的正式业务契约，本批次仅接线，不新增后端接口或迁移：

| 契约 | 前端用途 |
| --- | --- |
| GET /api/users：keyword/role/status/page/page_size | 管理员服务端筛选；keyword 仅用户名 |
| GET /api/courses：mine=true、joined | 教师本人负责课程与真实成员状态 |
| GET /api/courses/{id}：is_owner/can_post | 课程发布资格与负责教师认证入口 |
| 问题列表、详情、搜索及聚合：course_name | 直接展示真实课程名，移除全站课程名扫描 |
| GET /api/users/{id}/questions 与 /answers | 用户公开内容的登录后分页读取 |
| GET /api/tags/{id} | 标签详情资源读取与404处理 |
| PATCH /api/users/me：username、bio/avatar_url 显式 null | 资料维护；缺失保留与显式清空区分 |
| 已有助教申请/审核与问答互动接口 | 补前端入口和实际页面核心操作，不更改权限 |

AI 页面、治理、期限封禁、课程高级管理等无正式数据源或明确延期条目保持暂缓；前端按钮不得模拟完成。真实 MySQL 并发、部署与人工视觉验收仍属独立缺口。此补充优先于上文相关旧“前端未启动”的历史状态，不据此重写历史批准记录。

## 6. 存储策略

### PR27 审查问题修复（2026-10-09 用户确认）

- 用户授权本清单全部修复后统一验收，仍逐板块验证、独立中文提交，不 push；仅回答可达性、封禁审计及相关过期文档，不自动推进 F-C5 或其他 F-C6 项。
- 回答沿用 GET `/api/questions/{id}/answers` 的 sort/page/page_size，前端展示真实 total 和分页；`#answer-{id}` 通过现有分页逐页查找，渲染目标页后定位。无目标时明确提示，切问题/排序或新锚点取消过期结果，不新增定位接口或静默扫描页数上限。大列表定位请求成本为 O(页数)，后续可独立评估服务端定位契约。
- identity 新增 `user_status_audits`：id、actor_id/target_user_id（users FK，不级联删除）、action（ban/unban）、previous_status/new_status、previous_reason/new_reason（各≤200字）、created_at（应用生成 UTC，数据库存 naive UTC）。目标与操作者索引带 created_at/id，无正文、密码、令牌等额外快照。
- JWT 管理员 id 由 router 传 service，不接受客户端指定操作者；repository 锁定刷新目标行后输出 schema，状态修改及追加审计共享事务，service 统一 commit/rollback。重复成功操作仍追加审计，重复解禁继续幂等成功。无审计更新/删除或查询业务接口；这不是数据库管理员无法篡改的防篡改系统。
- 新 Alembic revision 只建新增审计表及索引，不回填猜测的历史记录、不清库。用户确认当前本地库仅测试用途，可执行 upgrade head 并核验结构。降级会删除审计历史，禁止在此次验收中默认执行。
- 验证：前端目标回答真实渲染/分页/总数/缺失与过期请求；后端操作者不可伪造、权限拒绝无审计、重复操作历史、旧原因保留、写入及提交故障全回滚；pytest/ruff/lint-imports、迁移及本地 MySQL 定向事务检查。限时封禁、热门内容和审计 UI 仍不在本次范围。

- 全部持久化数据统一存 MySQL；Agent 无独立数据库，通过内部接口读写（C-05/C-07）。
- SQLAlchemy 同步模式 + PyMySQL；结构变更一律走 Alembic 迁移，不手改表。
- 切换 async SQLAlchemy（asyncmy/aiomysql）属于后续决策，需先回改本文档。
- AgentMemory：按 `user_id + memory_type + course_id? + source_run_id` 存储，正文写入前做敏感信息过滤；用户可删除或禁用影响自己的记忆。
- ApprovalRequest：保存风险等级、动作类型、目标对象、快照摘要、原因、状态与处理人；真正的隐藏、删除、封禁由 FastAPI 审批接口执行。
- ToolCallLog：只保存工具名、参数摘要、结果摘要、耗时、状态、trace id；禁止保存 API Key、Cookie、密码、完整隐私原文。
- MCP Server 配置为第二阶段表结构，第一阶段可只保留 mock 配置与策略测试数据。

## 7. 目录结构设计

以 [docs/后端架构说明.md](../docs/后端架构说明.md) 第 7 节为权威（6 模块 × 5 文件 + core + db，2026-09-20 已落地）；前端见 [docs/前端架构/前端服务需求文档.md](../docs/前端架构/前端服务需求文档.md)。Agent 侧关键目录（第二阶段）：

```text
agent/src/
├── tools/registry.ts      # Agent 工具白名单注册
├── loop/                  # 第一阶段 Agent Loop 主循环、停止条件、自检逻辑
├── tasks/                 # 任务路由：标签推荐、相似问题、风险预警、问答检索
├── agents/                # 第二阶段角色化扩展点；第一阶段不实现多 Agent 协作
├── mcp/                   # MCP Adapter：client / registry / policy / adapter
├── memory/                # 记忆读写（经 FastAPI）、摘要、选择
├── approvals/             # 高风险动作审批策略
└── observability/         # trace id、运行日志
```

## 8. 风险与技术难点

| 编号 | 描述 | 应对 |
| ---- | ---- | ---- |
| T-01 | AI SDK 7 强制 Node ≥ 22 且 ESM，@modelcontextprotocol/sdk 协议版本需匹配 | package.json 锁 engines；升级跑官方 codemod |
| T-02 | MCP 工具可能被模型用于绕过业务权限 | 仅白名单注册；policy.ts 风险分级 + 审批工单 |
| T-03 | 记忆泄露隐私原文 | 后端写入前过滤校验；定期审计 memory 内容 |
| T-04 | 流式响应在 BFF 转发时断流/缓冲 | Route Handlers 透传 SSE，不缓冲 |
| T-05 | 过早实现多 Agent 导致展示重点发散、工期失控 | 第一阶段坚持单 Agent Loop + task router；多 Agent 只作为 `agent/src/agents/` 扩展点 |
| T-06 | 完整 OpenTelemetry/OTLP 链路对课程项目过重 | 第一阶段实现 trace id 透传 + MySQL 日志；第二阶段再接 OTLP exporter |
