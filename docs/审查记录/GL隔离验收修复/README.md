# GL 隔离验收修复包（待评审合入）

> 生成时间：2026-10-30
> 来源：腾讯云轻量隔离环境（MySQL 8.0.45，真实三服务）上的 GL-01B / GL-02B / GL-06 验收
> 状态：**已在服务器副本验证通过，未推送、未合并；** 本目录 `fixes.diff` 为完整补丁
> 关联记录：[../../Agent层验证记录/GL治理Loop与安全Hooks.md](../../Agent层验证记录/GL治理Loop与安全Hooks.md)

## 修复清单

| # | 文件 | 问题 | 后果 | 修复 |
| --- | --- | --- | --- | --- |
| 1 | `backend/app/modules/qa/models.py` | `questions.accepted_answer_id` 的 `use_alter` 循环外键未命名 | 真实 MySQL 上 `Base.metadata.drop_all` 抛 `CircularDependencyError`（未命名约束还会 `AssertionError`），测试库无法清理，并发验收无法重复执行 | 外键命名 `fk_questions_accepted_answer` |
| 2 | `backend/tests/test_governance_execution_concurrency.py` | 夹具未处理 MySQL 循环外键与 `use_alter` 约束 | 首个用例通过但 teardown 失败，后续用例因「库非空」setup 失败 | 建/删表时 `SET FOREIGN_KEY_CHECKS=0/1`，删表前 `_relax_use_alter_fks()` 去掉 `use_alter` |
| 3 | 8 个历史迁移的 `downgrade()` | 先 `op.drop_index(...)` 再 `op.drop_table(...)` | MySQL 报 `1553 Cannot drop index ... needed in a foreign key constraint`，**降级到 base 必然失败**，回滚方案不可用 | 删除冗余 `drop_index`（删表已包含索引与外键）；保留原语句为注释便于追溯 |
| 4 | `backend/alembic/versions/fix_updated_at_default.py`（新增） | `moderation_cases.updated_at` 模型有 `server_default`，`t16_add_agent_decision` 却以 `nullable=True` 无默认值添加 | 真实库新建治理工单写入 NULL → 建单接口 500；SQLite 用模型建表不可见 | 回填 NULL 后设 `NOT NULL DEFAULT CURRENT_TIMESTAMP`；`down_revision = gl04_job_resume` |

涉及迁移：`4ff9e6a9b6e0`、`5d17479735ac`、`614ffbaac7c4`、`7d3e9c4a1b52`、`a44b1c09079e`、`ax_c_experiences`、`c04234113d33`、`f9c6a0c48f93`（共 32 处 `drop_index` 去冗余）。

### 5. 前端 BFF Cookie：Secure 开关（验收后追加）

`frontend/src/app/api/backend/[...path]/route.ts`

问题：`tokenCookie()` / `clearCookie()` 在 `NODE_ENV=production` 时固定加 `; Secure`；部署在纯 HTTP 的隔离环境时浏览器会丢弃 `co_token`，登录接口返回 200 但页面无跳转，表现为「点登录没反应」。

修复（默认行为不变，仅显式配置时关闭）：

```ts
function cookieSecure(): string {
  // 生产默认加 Secure（HTTPS）；HTTP 隔离环境用 COOKIE_SECURE=false 显式覆盖，
  // 否则浏览器会丢弃 Secure Cookie，表现为“登录无反应”
  return process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false"
    ? "; Secure"
    : "";
}

function tokenCookie(token: string): string {
  const secure = cookieSecure();
  ...
}

function clearCookie(): string {
  const secure = cookieSecure();
  ...
}
```

配套：`env/frontend.env` 增加 `COOKIE_SECURE=false`。

> **生产环境必须使用 HTTPS 且保持 `Secure`**（不要设置该变量），否则会话可被明文嗅探。
> 该补丁未进入 `fixes.diff`（diff 生成于修复前，且仅落地在服务器副本），以本节代码为准。

## 验证

| 环境 | 命令 | 结果 |
| --- | --- | --- |
| 服务器（MySQL 8.0.45） | `pytest tests/test_governance_execution_concurrency.py -v` | 2 passed（真实双连接并发） |
| 服务器（MySQL 8.0.45） | `alembic upgrade head` → `downgrade base` → `upgrade head` | 全部 exit 0，24 步降级，`heads` 唯一 `fix_updated_at_default` |
| 服务器 | `pytest -q`（全量） | 693 passed / 20 skipped |
| 服务器 | `ruff check .` / `lint-imports` | 全绿 / 5 契约 KEPT |

> 说明：补丁只在**服务器部署副本**上落地与验证；本目录的 `fixes.diff` 是从该副本导出的改动，本地工作区未保留这些修改（临时副本已回退），合入时以 diff 为准。

## 合入建议

1. 建议按「模型与外键命名」「测试夹具」「迁移降级顺序」「新迁移」拆成 4 个提交，便于逐条审查。
2. 新迁移已使 head 前移，合入后所有环境需执行 `alembic upgrade head`；`downgrade` 只对可丢弃库验证过。
3. 若团队不接受给循环外键命名（会与既有库中 MySQL 自动命名的约束名不一致），可退化为「仅测试夹具按表名逐个删表」；但那样 `drop_all` 在真实库上仍不可用，需同步调整 `tests/conftest.py`。
4. 生产库不建议直接跑 `downgrade base`：本次只验证了语法与顺序可行，未在生产数据上演练。
