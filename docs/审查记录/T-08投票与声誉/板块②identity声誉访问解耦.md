# 板块②：identity 声誉访问解耦

## 状态与范围

- 日期：2026-10-02。
- 用户已批准设计与实施，并要求补写本记录；本记录不等同于 T-08 整体验收。
- 本板块尚未提交或推送，不勾选 T-08 整体完成。
- 范围：消除 interaction repository 对 identity 用户 ORM 的直接访问，保留原积分政策、HTTP 接口、榜单窗口与排序。
- 不包含：QA 跨模块模型访问整改、并发锁协议、表结构迁移及积分政策调整。

## 设计依据

实施前读取 AGENTS.md、specs/constitution.md、specs/spec.md、specs/plan.md、specs/tasks.md、specs/analyze.md、docs/后端架构说明.md、docs/后端架构/分层架构设计基线.md、docs/后端架构/学生端接口文档.md及工作区规则。

- US-08、T-08：声誉变化配套积分流水，支持声誉查询与榜单。
- 分层基线 D-2、D-5：ORM 不上浮，跨模块只调用对方 service；用户模型的读写应由 identity repository 承担。
- 分层基线 D-4：repository 提供数据访问能力，不接管业务用例编排。
- 分层基线 D-8、架构说明 §4.B：repository 只 flush，最外层用例提交；声誉总分和流水必须参与同一事务。
- 使用 brainstorming 明确小板块边界，使用 api-and-interface-design 约束内部接口；实施遵循 ponytail、test-driven-development、git-workflow-and-versioning 与 verification-before-completion。

## 实现内容

涉及以下后端文件：

- app/modules/identity/repository.py：承接声誉总分增量与累计总榜查询。
- app/modules/identity/service.py：显式提供内部调用接口，共用调用方 Session，不自行 commit。
- app/modules/identity/schemas.py：定义累计榜所需内部数据契约，避免返回 ORM 或依赖 interaction 响应类型。
- app/modules/interaction/repository.py：移除 User 模型访问，保留本模块流水聚合。
- app/modules/interaction/service.py：调用 identity service，批量补齐窗口榜用户名。
- pyproject.toml：删除 interaction.repository → identity.models 导入豁免，保留尚未整改的 QA 豁免。
- tests/test_interaction_votes.py：补充事务回滚和榜单边界回归。

已有 qa/schemas.py 说明修改及板块①记录未触碰。两层 .gitignore 已覆盖验证缓存和编译产物，无需为本板块修改。

## 验证记录

以下为实施阶段实际执行结果的整理，本次补写记录未重新运行测试。后端命令工作目录为 campus-overflow-ai/backend/。

### 测试先失败，再实现

命令：

```powershell
uv run pytest -q tests/test_interaction_votes.py -k 'rollback or log_failure or total_rank or window_rank'
```

- 实现前：5 failed、2 passed。失败涉及 identity 尚无新增接口、窗口榜尚未使用批量用户名服务。
- 实现后：7 passed、26 deselected。
- 覆盖重点：显式 rollback 撤销总分和流水；流水失败不提前提交；累计榜保留零分用户、同分按 ID 排序及 10 条上限；窗口榜批量补用户名后保持排序。

### 最终检查

| 命令 | 结果 |
| --- | --- |
| uv run pytest -q | 185 passed，2 warnings，退出码 0 |
| uv run ruff check . | All checks passed，退出码 0 |
| uv run lint-imports | 4 kept，0 broken，退出码 0 |
| uv run python -m compileall -q app tests alembic | 退出码 0 |
| git diff --check | 退出码 0，仅 LF→CRLF 提示 |

两条警告为既有 Starlette/httpx、AnyIO 弃用警告，未扩大范围调整依赖。

测试基于 SQLite 内存夹具，不能作为真实 MySQL 迁移或并发行为的证据。本板块未修改表结构，未执行 MySQL 迁移或并发验证。分层检查通过也不代表剩余 QA 导入豁免已整改。

## 决策说明

1. **先清除 identity 导入边，暂不同时改 QA。** identity 访问集中于总分更新和榜单，已有批量用户名接口可复用；QA 访问涉及更多目标查询及双方 service 依赖，另开板块审查。
2. **模块归属按数据所有者划分。** 用户总分与累计总榜归 identity；声誉流水及周/月/课程聚合仍归 interaction。不新增 UoW、事件总线、依赖或迁移。
3. **保持最外层用例提交。** identity 增量接口不 commit，防止流水写入失败时用户总分已独立持久化。新增回归验证 rollback 行为，不把参与函数误当独立事务用例。
4. **保持可观察行为。** 不改积分值、不新增缺失用户错误语义；累计总榜包含零分用户，分数降序、同分 ID 升序；窗口仍为滚动 7/30 天，课程过滤沿用流水快照。
5. **先排除缺失用户，再取前 10。** 窗口榜读取聚合候选，一次批量补用户名，再筛选和截取，避免先截取导致有效条数缩水。未采用逐用户查询，避免 N+1。

### 遗留限制

- 窗口榜候选集与批量查询参数规模随参与用户数增长，尚无负载验证；本次不引入缓存或扩大为榜单性能改造。
- QA 跨模块 ORM 访问及其导入豁免尚在。
- 投票并发一致性及真实 MySQL 验证尚未完成。
- 整体 T-08 仍需后续审查与验收；本记录不宣称所有架构或业务问题已解决。
