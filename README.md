# CampusOverflow AI

面向高校课程场景的 AI 问答与内容治理平台。

它不是一个“给论坛加一个聊天框”的项目，而是一套把 AI 放进真实业务约束里的系统：课程是权限边界，业务事实只由 FastAPI 与 MySQL 决定，AI 只负责分析、检索和建议，高风险动作必须经过人工确认后由后端执行。

> 设计立场：**AI 只建议，不处置；默认关闭，失败隔离；先有证据，再谈效果。**

## 1. 设计目标

| 目标 | 具体约束 |
| --- | --- |
| 业务事实唯一 | 用户、课程、问答、审批、审计只存 MySQL，只有 FastAPI 能写；Agent 不直连业务库 |
| 权限最小化 | RBAC 三角色 + 课程范围 + 助教能力位；工具白名单与数据范围取交集 |
| 风险可治理 | 隐藏、删帖、封禁等动作只生成待确认工单，人工确认后由后端复核并执行 |
| 能力可运维 | 新增能力默认关闭，具备开关、回滚、失败隔离与审计 |
| 效果可验证 | 关键设计用对照实验与配对统计验证，不用“跑通了”代替“有效” |

## 2. 系统架构

```text
浏览器：学生端 / 教师端 / 管理端
                │
        Next.js 页面与 BFF
           │            │
     业务请求        AI 请求（SSE）
           │            ▼
           │      Hono / Nitro Agent
           │        │        │        │
           │        │        │        └── MCP（只读、白名单、限流）
           │        │        └── Workflow ── 独立 PostgreSQL（运行状态）
           │        └── 工具网关 / 策略 / 审批 / 观测
           ▼
        FastAPI ── MySQL（业务事实与最终授权）
           ▲
           └── /internal/agent/*（服务凭证 + trace id）

Markdown / Wiki ── 知识目录 ── RAG（卡片摘要 + 正文；HNSW + BM25 + RRF）
```

| 服务 | 职责 | 不做什么 |
| --- | --- | --- |
| Next.js | 三端页面、BFF 转发、SSE 透传、文件导出 | 不写核心业务规则 |
| FastAPI | 认证、RBAC、课程、问答、事务、审批、审计 | 不调用模型做决策 |
| Agent | 单 Agent Loop、任务路由、工具调用、RAG、MCP、审批编排 | 不直连 MySQL，不执行高风险处置 |
| MySQL | 业务事实、权限、审批与回执 | 不存模型临时状态 |
| PostgreSQL | Workflow 运行状态、队列与恢复数据 | 不替代业务库，不存私人会话 |
| Markdown | 教材与知识参考 | 不承担授权，不作为业务事实 |

## 3. 关键设计

### 3.1 权限与事实边界

- 角色固定为 `student / teacher / admin`；助教不是第四种角色，而是“研究生 + 助教认证”解锁的能力位。
- 所有课程资料、问答与教学能力都带课程范围；模型参数不能扩大课程范围。
- Agent 的业务读写只走 `/internal/agent/*`，服务间凭证鉴权并透传 `x-trace-id`。
- 记忆不作为授权：个人记忆按账号隔离、可清空，学生/教师保存在浏览器，管理员私人上下文保存在服务器私有目录。

### 3.2 治理闭环

```text
巡检/全量扫描发现内容
  → 后端创建或复用任务
  → 读取目标与版本
  → 模型规划
  → 逐项生成待确认工单
  → 人工确认
  → 后端复核权限与目标版本
  → 原子执行并写审计/回执
  → 重新观察 → 评估 → 完成 / 下一轮 / 转人工
```

- 最多 5 轮完整 loop；一轮可有多个动作，不把每次动作当成一轮。
- 审批冻结动作、参数与目标版本；目标变化或结果未知时转人工，不能换任务重置轮数。
- 高风险动作没有“模型直接执行”的旁路。

### 3.3 RAG 检索

知识不是一堆等长 chunk，而是“课程 → 卡片 → 摘要/正文”的结构：

- 摘要用于快速召回卡片，正文按段落切块用于取证；
- 稠密向量（Qwen/GLM OpenAI 兼容 embedding）+ 中文双字 n-gram/BM25 关键词并行召回；
- RRF 融合，默认 `N=20`、`K=5`、`k=60`，不直接相加不同量纲的原始分数；
- HNSW 内存索引，默认 `M=16`、`efConstruction=200`、`efSearch=64`；规模面向 1～10 本教材，不引入独立向量库；
- 课程范围在工具闭包绑定，模型不能通过参数换课程；执行前用用户凭证复核课程资料权限；
- `RAG_ENABLED=false` 默认关闭；索引构建或检索失败只记录脱敏摘要并降级，不阻断问答。

对应代码：`campus-overflow-ai/agent/src/knowledge/rag/`、`campus-overflow-ai/agent/src/tools/search-knowledge.ts`。

### 3.4 Agent 工具与 MCP

- 工具统一注册，未注册不可调用；规划只使用当前请求注册表内的工具。
- 工具可用性 = 注册白名单 ∩ 角色权限 ∩ 数据范围；主规则和模型都不能扩权。
- MCP 只读、白名单、scope 映射；每客户端支持主/备双 token 轮换与过期，进程内令牌桶默认 60 次/分钟。
- 限流发生在鉴权之后、工具执行之前；拒绝会写审计，不触发工具。

### 3.5 可观测与可回滚

- 每次 run、tool call、approval request 记录 trace id、`agent_run_id` 与脱敏摘要。
- 夜间整理、全量扫描、MCP 扩展、快照读取均有独立开关。
- 知识/问答索引采用双槽快照，校验后切换，旧槽保留可回退。

## 4. Cross-testing 对照实验

[Cross_testing](./Cross_testing) 用于验证“卡片结构、分层检索、混合召回、HNSW”分别带来了什么，而不是笼统宣称“我的 RAG 更好”。

六个变体共享同一语料、同一批 query、同一 embedding 与同一 top-K，一次只改一个变量：

| 变体 | 验证点 |
| --- | --- |
| `fixed-dense-flat` | 传统固定 chunk RAG 基线 |
| `card-dense-flat` | 只改切分：卡片摘要/正文 |
| `card-hybrid-flat` | 只改召回：稠密 + BM25 + RRF |
| `card-hierarchical-flat` | 只改层级：先摘要召回，再展开正文 |
| `card-hierarchical-hybrid-flat` | 分层 + 混合 |
| `card-hybrid-hnsw` | 只改索引：Flat vs HNSW |

指标包括 Recall@K、全证据率、MRR、上下文精度、上下文字符、P95 延迟与无答案命中率；配对比较使用 bootstrap 95% CI 与 Wilcoxon 符号秩检验。gold 按原文 quote 标注，因此同一份数据可以映射到不同切分。

```bash
cd Cross_testing
npm test          # 管线自检
npm run rag       # 生成 results/ablation.md 与 .csv
```

当前 fixture 是合成数据与确定性哈希向量，只证明对比管线可运行；真实结论必须使用真实教材、真实 embedding 与人工标注。方法与限制见 [Cross_testing/README.md](./Cross_testing/README.md)。

## 5. 目录

```text
workplace/
├── campus-overflow-ai/
│   ├── backend/        FastAPI + SQLAlchemy + Alembic + MySQL
│   ├── frontend/       Next.js 16 App Router + BFF
│   ├── agent/          TypeScript Agent：Loop、工具、RAG、MCP、Workflow
│   ├── deploy/         部署配置
│   └── tests/          跨服务测试
├── Cross_testing/      RAG 切分与检索策略对照实验
├── .github/            CI
└── README.md
```

本地设计与验收资料（`docs/`、`specs/`）、AI 规则（`.trae/`）、个人笔记与归档目录不随仓库发布。

## 6. 本地运行

```bash
# 后端：campus-overflow-ai/backend
uv venv
uv pip install -e ".[dev]"
uv run alembic upgrade head
uv run uvicorn app.main:app --reload

# 前端：campus-overflow-ai/frontend
npm ci
npm run dev

# Agent：campus-overflow-ai/agent
npm ci
npm run dev
```

默认端口：Next.js `3000`、FastAPI `8000`、Agent `8787`。数据库、内部回调与 MCP 不作为浏览器入口。

## 7. 验证

| 范围 | 命令 |
| --- | --- |
| 后端 | `uv run pytest`、`uv run ruff check .`、`uv run lint-imports` |
| 前端 | `npm test`、`npm run lint`、`npm run check:rules` |
| Agent | `npm test`、`npm run typecheck`、`npm run lint`、`npm run build` |
| RAG 评测 | `npm run rag:eval`（fixture，仅验管线） |
| 对比实验 | `cd Cross_testing && npm test && npm run rag` |
| 治理 dry-run | `uv run pytest tests/test_governance_dry_run.py -q` |
| 真实 MySQL 并发 | 启动 `deploy/test-sandbox` 后设置 `TEST_MYSQL_URL`，再跑 `tests/test_patrol_scan_concurrency_mysql.py` |

CI 在 main 推送或 PR 时执行各服务检查。开发期按改动范围跑冒烟，全量回归交给 CI；高风险路径（权限、事务、审批、记忆过滤、工具白名单、trace 透传）必须有测试。

## 8. 沙箱与验证

| 沙箱 | 用途 | 边界 |
| --- | --- | --- |
| 治理 dry-run | 预演隐藏/删除/封禁的影响 | 只读，不建单、不写审计、不改状态 |
| `deploy/test-sandbox` | 真实 MySQL/Postgres 并发与迁移 | 仅本机端口，不承载真实数据 |
| `deploy/mcp-sandbox` | 隔离 MCP 外部工具 | 非 root、只读根文件系统、无数据库变量 |
| `Cross_testing` | 对照 RAG 切分与检索策略 | 合成 fixture 只验管线，不证明效果 |

## 9. 当前状态与限制

- 业务后端一期完成，二期继续扩展；前端持续补完。
- Agent 的治理、工具、RAG、MCP 主链路已实现，相关能力默认关闭。
- RAG 尚未用真实 Qwen/GLM embedding 跑过，未完成 50 题人工标注 pilot；无答案阈值与 HNSW 调参仍待真实数据。
- 未完成生产部署、多实例调度、并发压测与告警；治理链路的真实环境验收仍有未完成项。
- 合成数据与 HTTP 替身只能证明编排与安全链路，不能证明真实模型效果。

## 10. 文档

- 项目 Wiki（架构、治理、沙箱、RAG、测试、燃尽）：[wiki/README.md](./wiki/README.md)
- Agent 运行、工具与 RAG 接入：[campus-overflow-ai/agent/README.md](./campus-overflow-ai/agent/README.md)
- 对比实验方法：[Cross_testing/README.md](./Cross_testing/README.md)
- 后端模块与分层：`campus-overflow-ai/backend/app/modules/`
- 设计与验收记录保留在本地 `docs/`、`specs/`，不随仓库发布。
