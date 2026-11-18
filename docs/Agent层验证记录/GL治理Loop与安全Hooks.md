# GL 治理 Loop 与安全 Hooks：隔离环境部署与验收记录

> 记录时间：2026-10-30
> 执行环境：腾讯云轻量应用服务器（上海 ap-shanghai-5，lhins-d2qwu0ys，4C/4G/40G）
> 部署 SHA：`86037f047ab9712a8ac70c369b353c8bd6ce5f0f`（分支 `feat/approvals-preview`）
> 结论：GL-01B 达成；GL-02B、GL-06 部分达成（详见验收矩阵的未通过/未执行项），二者保持未勾选。

## 一、部署信息

### 1.1 代码来源与 SHA 核对

| 项 | 结果 |
| --- | --- |
| 团队仓库 | `hbuas-se-2026fall/cs2411-team06-campus-overflow`（私有） |
| 目标分支 | `feat/approvals-preview` |
| 部署 SHA | `86037f047ab9712a8ac70c369b353c8bd6ce5f0f`（与交接值一致） |
| `origin/main` | `16d204527a31d203f3618e25def037dab976c481`（**不包含** 86037f0，故不使用 main） |
| PR #5 | 本机 GitHub 直连被代理返回 502、`api.github.com` 对私有库返回 404，**PR 状态未能在线上复核**；以远端跟踪引用（2026-10-30 13:30 更新）为准 |
| 服务器取码路径 | 公开镜像 fork `SongF0140/CampusOverflow_HWA` 的 `feat/approvals-preview`（API 校验 SHA 与交接值完全一致），经 `gh-proxy.com` 拉取 |

> 说明：服务器无法直连 github.com（`git ls-remote` 超时），团队仓库为私有库无法经镜像匿名克隆，因此使用**内容等价的公开 fork 提交**部署；部署后 `git rev-parse HEAD` 与交接 SHA 严格一致，可逐提交追溯。

### 1.2 拓扑与端口

| 组件 | 运行方式 | 监听 | 版本/说明 |
| --- | --- | --- | --- |
| 前端 Next.js（学生端） | systemd `campus-gl-frontend` | `0.0.0.0:3000` | Next.js 16 / React 19，`/` |
| 前端 Next.js（教师端） | systemd `campus-gl-frontend-teacher` | `0.0.0.0:3010` | 同一构建产物，入口 `/teacher` |
| 前端 Next.js（管理端） | systemd `campus-gl-frontend-admin` | `0.0.0.0:3020` | 同一构建产物，入口 `/admin` |
| 业务后端 FastAPI | systemd `campus-gl-backend` | `127.0.0.1:8000`（不暴露公网） | uvicorn，uv venv（Python 3.11.6） |
| Agent 服务 | systemd `campus-gl-agent` | `127.0.0.1:8787`（不暴露公网） | Node 22.23.4（独立安装，未复用鸿蒙工具链） |
| MySQL | 系统包 `mysqld` | `127.0.0.1:3306`（不暴露公网） | MySQL 8.0.45（真实 MySQL，非 MariaDB） |

> 三端各占独立 origin（端口），浏览器 Cookie 按 origin 隔离，可**同时**以学生/教师/管理员身份登录、并行对照，互不顶号。主机 `firewalld` 与轻量云防火墙均已放行 3000/3010/3020。

目录约定（全部隔离，未触碰既有 1Panel 应用、MongoDB/Redis/UptimeKuma/FileBrowser 容器与反向代理）：

```
/opt/campus-overflow-test/
  repo/                  # 代码（git HEAD = 86037f0）
  env/                   # 服务环境文件（600）
  secrets/               # 密钥与本机 MySQL client 配置（600/700）
  private-context/       # BACKEND_PRIVATE_CONTEXT_ROOT
  logs/                  # 后端/Agent/前端/迁移日志
  backup/ restore-drill/ # 备份与恢复演练
  e2e/                   # 验收脚本与状态
```

### 1.3 脱敏配置清单

| 变量 | 作用 | 取值方式 |
| --- | --- | --- |
| `BACKEND_DATABASE_URL` | 应用库连接（专用账号 gl_app，仅本库权限） | 随机口令，文件保存 |
| `BACKEND_JWT_SECRET` | JWT 签名 | `openssl rand -hex 24` 生成，非仓库默认值 |
| `BACKEND_AGENT_SERVICE_TOKEN` | 服务间凭证 | 随机生成；**部署中发现原配置缺该项会回落到仓库默认值，已补齐并重启** |
| `BACKEND_GOVERNANCE_EXECUTOR_TOKEN` | 专用执行器凭证 | 随机生成，与普通服务凭证不同 |
| `BACKEND_GOVERNANCE_EXECUTOR_ENABLED` | 后端 v2 治理开关 | 先 `false`（隔离确认）后按测试需要置 `true` |
| `BACKEND_PRIVATE_CONTEXT_ROOT` | 私人上下文根 | `/opt/campus-overflow-test/private-context` |
| `AGENT_SERVICE_TOKEN` | Agent → 后端服务凭证 | 与后端同值 |
| `GOVERNANCE_EXECUTOR_ENABLED` | Agent 后台执行器开关 | 默认 `false`；链路验证期间开启，验收后再次关闭 |
| `GOVERNANCE_EXECUTOR_TOKEN` | 执行器凭证 | 与后端同值，与普通服务凭证不同 |
| `AGENT_PORT` / `BACKEND_BASE_URL` | 端口与后端地址 | 8787 / `http://127.0.0.1:8000` |
| `BACKEND_ORIGIN` / `AGENT_ORIGIN` | 前端 BFF 目标 | `127.0.0.1:8000` / `127.0.0.1:8787` |
| `OPENAI_API_KEY` 等 | 模型接入 | **管理员端后台配置**；对应管理页与接口尚未实现（已确认设计），本次未配置，真实模型冒烟跳过 |

所有密钥仅存于服务器 `env/`、`secrets/`（600/700），未进入仓库、日志或本记录。验收过程中一次 MySQL client 配置写错键名导致 root 口令回显到命令输出，已**立即轮换 root 口令**（旧值作废），此后统一改用 `--defaults-extra-file` 传参。

### 1.4 数据库划分

| 库 | 用途 | 账号 | 说明 |
| --- | --- | --- | --- |
| `campus_gl_app` | 三服务端到端验收 | `gl_app`（仅本库） | `alembic upgrade head` = `fix_updated_at_default` |
| `campus_gl_test_empty` | 并发测试（会建表/删表） | `gl_test`（仅本库） | 必须为空；测试自带建表与清理 |
| `campus_gl_migrate` | 迁移升降级 / 恢复演练目标 | `gl_migrate`（仅本库） | 可丢弃 |

## 二、启停、健康检查与故障恢复

### 2.0 三端访问入口（演示用）

| 端 | 地址 | 演示账号 | 密码 |
| --- | --- | --- | --- |
| 学生端 | `http://106.54.208.203:3000/` | `gl_student` | `Gl-Test-2026!seed` |
| 教师端 | `http://106.54.208.203:3010/teacher` | `gl_teacher` | 同上 |
| 管理端 | `http://106.54.208.203:3020/admin` | `gl_admin1`（第二管理员 `gl_admin2`） | 同上 |

演示数据：课程「软件工程实践（SE-DEMO-2026F）」含 3 个问题、3 个回答（1 个已采纳）、内联标签；管理端有 1 条待审 `hide` 工单（对应问题 #13）。建议路径：管理端点「同意」→ Agent 执行器领取并执行 → 学生端刷新后该问题不可见 → 管理端可查回执。

> 仅测试数据，账号为隔离环境专用；不要与真实师生数据混用。
> 关闭自动执行：`sed -i 's/GOVERNANCE_EXECUTOR_ENABLED=true/false/' /opt/campus-overflow-test/env/agent.env && systemctl restart campus-gl-agent`

```bash
# 启停（三服务 + 数据库）
systemctl start|stop|restart campus-gl-backend campus-gl-agent campus-gl-frontend
systemctl start|stop|restart campus-gl-frontend-teacher campus-gl-frontend-admin
systemctl start|stop mysqld

# 健康检查（本机）
curl -s http://127.0.0.1:8000/health            # backend
curl -s http://127.0.0.1:8787/health            # agent
curl -s http://127.0.0.1:3000/api/health        # frontend + BFF 到后端/Agent 的连通性
# 公网（仅前端）：http://106.54.208.203:3000

# 日志
tail -f /opt/campus-overflow-test/logs/{backend,agent,frontend}.log
tail -f /opt/campus-overflow-test/logs/*.err.log
journalctl -u campus-gl-backend -n 200 --no-pager

# 数据库
mysql --defaults-extra-file=/opt/campus-overflow-test/secrets/root.cnf -e 'SHOW DATABASES;'
```

健康检查实测：`backend up`、`agent ok`、`frontend/backend/agent 全 up`（前端 `/api/health` 汇总 BFF 到两个下游的连通性），公网 `3000` 可访问。

故障恢复顺序：`mysqld` → `campus-gl-backend` → `campus-gl-agent` → `campus-gl-frontend`（unit 已声明依赖）。重启后私人上下文与治理状态均从磁盘/数据库恢复（已实测）。

## 三、验收矩阵

> 证据统一为：命令输出摘要 + 关联标识（request_id / execution_id / case_id）。不含密钥与个人原文。

### 3.1 GL-01B 版本化批准契约（真实 MySQL）

| # | 项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 独立 MySQL 迁移（升级/降级/再升级、唯一 head） | ✅ | `campus_gl_migrate` 上 `upgrade head`(exit 0) → `downgrade base`（24 步，exit 0）→ `upgrade head`(exit 0)；`alembic current` = `fix_updated_at_default`，`alembic heads` 唯一 |
| 2 | 双连接并发批准只产生一个执行任务 | ✅ | `test_governance_execution_concurrency.py::test_mysql_concurrent_approve_and_execute_return_one_receipt` PASSED；两线程并发 approve 返回同一 `execution_id`/`approved_by` |
| 3 | 旧快照不能隐藏已撤权身份 | ✅ | 同文件 `test_mysql_old_snapshot_cannot_hide_revoked_identity` PASSED |
| 4 | 批准只建授权与任务，不伪报已执行 | ✅ | approve 后 `status=approved`、`executed=false`、`is_hidden=0`、`governance_execution_jobs` 1 条 `queued` |
| 5 | 重复批准幂等 | ✅ | 第二个管理员重复 approve 返回相同 `execution_id`；该 request 任务数恒为 1 |
| 6 | 篡改批准参数被拒 | ✅ | 错误 `args_hash` → 409 |
| 7 | 目标版本变化被拒 | ✅ | 陈旧 `expected_version` → 409「目标状态或内容已变化」 |
| 8 | 撤权后不能批准 | ✅ | 将 gl_admin2 降为 student 后 approve → 403；随后恢复 |

**GL-01B：达成。**

### 3.2 GL-02B 原子执行与幂等回执（真实 MySQL）

| # | 项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 批准前零执行 | ✅ | 申请后 `is_hidden=0`、无任务行 |
| 2 | 领取签发租约 | ✅ | claim 返回 `execution_id` + `lease` + `lease_epoch=1` |
| 3 | 伪造租约 / 错误 epoch 被拒 | ✅ | 两者均 403「执行租约无效、已过期或已被替换」，且目标未被修改 |
| 4 | 并发执行仅一次业务副作用 | ✅ | 两线程同租约执行均 200，`is_hidden=1` 且仅一次；任务 `completed` |
| 5 | 有效租约不重复领取 | ✅ | 持有租约期间再次 claim 返回**另一个**任务，而非同一任务（未重复签发） |
| 6 | 租约过期后新 epoch 接管，旧 epoch 失效 | ✅ | 人为使 `lease_expires_at` 过期 → 再次 claim 同一任务 `lease_epoch` 递增（1→2→3），旧 epoch 执行 403，新 epoch 执行 200 并落回执 |
| 7 | 完成任务不再被领取 | ✅ | 完成后 claim 不再返回该任务 |
| 8 | 执行器开关三态实际影响 | ⚠️ 部分 | 关闭态：v2 申请不落 `governance_approval_requests`（走旧等待路径）、无任务、无执行；开启后上述链路生效。演示期间 Agent 侧 `GOVERNANCE_EXECUTOR_ENABLED=true`（便于审批后自动执行），关闭方法见 2.0 |
| 9 | 进程终止/崩溃恢复（领取后执行前、提交前、提交后响应丢失） | ❌ 未执行 | 服务器安全策略禁止在实例上执行进程强杀类命令；改用「租约过期 + 旧 epoch 失效」等效注入（第 6 项），**不等同于真实进程崩溃验收** |
| 10 | 审计/通知写入失败不留半完成 | ❌ 未执行 | 需在真实环境注入数据库写入失败，未做（单元测试覆盖：`tests/` 内事务回滚用例） |
| 11 | 取消/过期/执行竞争一致性 | ❌ 未执行 | 未在真实环境构造竞争 |
| 12 | 结果未知有界核对转人工 | ❌ 未执行 | 依赖 Agent 侧循环与人工工单，未在真实入口验证 |

**GL-02B：部分达成，保持未勾选。** 真实 MySQL 并发与租约/幂等已取得证据；跨位置进程终止、审计失败注入、取消竞争、未知结果转人工四项缺真实环境证据。

### 3.3 GL-06 跨服务与私人上下文

| # | 项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 三服务互通与真实入口冒烟 | ✅ | 前端 `/api/health` 汇总 backend+agent 均 up；治理申请/批准/执行全链路经 HTTP 真实入口完成 |
| 2 | 管理员重启后会话与记忆可读 | ✅ | 写入后 `systemctl restart campus-gl-backend`，`entries=1`、`sessions=1` 仍可读 |
| 3 | 跨账号隔离 | ✅ | gl_admin2 读取同一接口得到空记忆；目录按 `admin/u_<id>/` 分账 |
| 4 | 并发写入版本冲突不静默覆盖 | ✅ | 旧 `version` 写入 → 409 |
| 5 | 损坏文件明确失败 | ✅ | 人为写坏 `memory.json` → 503「私人存储未配置、损坏或不可用」，恢复文件后 200 |
| 6 | 删除会话后迟到请求不恢复 | ✅ | `DELETE`(If-Match=1) → 墓碑 `version=2`；随后 `GET`/迟到 `PUT` 均 404，未复活 |
| 7 | 清空记忆后不再注入 | ✅ | 清空后 `entries=[]` |
| 8 | 落盘权限与位置 | ✅ | `700` 目录、`600` 文件，位于私有根目录，不在 public/static 与容器可写层 |
| 9 | 备份恢复演练 | ✅ | 私人目录 tar 备份并解压到 `restore-drill/`，`memory.json` SHA256 一致；数据库按表复制到独立库，`users/questions/governance_*` 行数一致 |
| 10 | 路径穿越 / 符号链接逃逸 | ⚠️ 部分 | 非 UUID 会话 id → 400（路径参数强类型）；**符号链接逃逸未实操验证** |
| 11 | 生产登录 HTTPS / Secure Cookie / SSE（反代下） | ❌ 未执行 | 隔离环境无测试域名与证书，按用户决策临时以 HTTP 暴露 3000/3010/3020；为让 HTTP 下可登录，已用 `COOKIE_SECURE=false` 显式关闭 Secure（**生产必须使用 HTTPS + Secure**，该项待有域名后补验） |
| 12 | 旧浏览器数据不自动导入 | ✅（设计+单测） | 代码无自动上传路径；真实浏览器迁移流程未实操 |
| 13 | 跨服务进程级故障注入 | ❌ 未执行 | 同 GL-02B 第 9 项限制 |

**GL-06：部分达成，保持未勾选。**

### 3.4 网关与安全边界（GL-03 相关，真实入口部分）

| # | 项 | 结果 | 说明 |
| --- | --- | --- | --- |
| 1 | 高风险执行工具不在普通模型工具清单 | ✅（测试） | Agent 全量 404 项通过，含注册表/权限/工具签名用例 |
| 2 | 普通服务凭证不能代替执行器凭证 | ✅（真实） | 执行接口要求 `X-Executor-Token`，缺失/错误一律 401/403；执行器 token 与普通服务 token 不同值 |
| 3 | 模型/外部密钥不能代替人工批准 | ✅（真实） | 未批准任何申请时任务不存在；批准接口仅接受管理员 JWT |
| 4 | chat / MCP / patrol / approved_worker 四入口实际绕过验证 | ⚠️ 未在真实入口执行 | 仅有单元/集成测试证据；真实入口依赖「管理员端配置模型凭证」的管理页与接口（尚未实现）以及 MCP 客户端，本次未配置 |
| 5 | 注入指令不改变身份/工具范围/批准参数 | ⚠️ 未在真实入口执行 | 同上，属单测覆盖范围 |

## 四、本次发现并修复的缺陷（均与部署验收直接相关）

| # | 缺陷 | 影响 | 修复 |
| --- | --- | --- | --- |
| 1 | `questions.accepted_answer_id` 的 `use_alter` 循环外键未命名 | 真实 MySQL 上 `Base.metadata.drop_all` 无法排序删表（`CircularDependencyError` / 未命名约束 `AssertionError`），并发测试无法清理 | 外键加名 `fk_questions_accepted_answer`；测试夹具在关外键校验下建/删表 |
| 2 | 7 个迁移的 `downgrade` 先 `drop_index` 后 `drop_table` | MySQL 报 1553（索引被外键占用），**降级到 base 必然失败**，回滚方案不可用 | 删表已含索引，移除冗余 `drop_index`（涉及 `4ff9e6a9b6e0`、`5d17479735ac`、`614ffbaac7c4`、`7d3e9c4a1b52`、`a44b1c09079e`、`c04234113d33`、`f9c6a0c48f93`） |
| 3 | `moderation_cases.updated_at` 模型有 `server_default`、迁移列却无默认值且可空 | 真实库新建工单写入 NULL → 建单接口 500（SQLite 用模型建表看不出来） | 新增迁移 `fix_updated_at_default`：回填 NULL 并设 `NOT NULL DEFAULT CURRENT_TIMESTAMP` |
| 4 | 后端环境缺少 `BACKEND_AGENT_SERVICE_TOKEN` | 服务间鉴权回落到仓库默认 `dev-agent-token`，违反「不使用仓库默认凭证」 | 生成随机值写入 env 并重启；已确认服务间调用使用新值 |
| 5 | 前端 BFF 在 `NODE_ENV=production` 时给 `co_token` 加 `Secure`，但隔离环境只有 HTTP | 浏览器静默丢弃该 Cookie：登录接口 200、页面无跳转，表现为「点击登录没反应」 | 增加显式开关 `COOKIE_SECURE=false`（默认行为不变，仅隔离环境覆盖）；三端实测 login 200 → `/users/me` 200 |

以上 1–3 为代码/迁移补丁，**仅在服务器部署副本上完成修复与验证**；为便于团队评审，已把服务器改动以 diff 形式导出到 `docs/审查记录/GL隔离验收修复/`（本地工作区未落地、未推送、未合并 PR）。模型凭证采用「管理员端后台配置」的既定设计，不写入部署环境。

## 五、回滚与备份

- **应用回滚**：`systemctl stop campus-gl-*` → `git -C repo checkout <上一 SHA>` → 重新 `uv pip install -e .` / `npm ci` / 构建 → `systemctl start`。迁移回滚仅在**可丢弃库**演练过（`downgrade base` 可用）；生产库降级仍需逐版本评估。
- **数据库备份**：`mysqldump --single-transaction --no-tablespaces` 被服务器安全策略禁止执行；本次采用 ORM 级按表复制到独立库验证可恢复性。**生产备份需在具备备份权限的环境用 mysqldump/物理备份执行。**
- **私人上下文备份**：`tar czf backup/private-context.tgz private-context`，解压到独立目录即可读回；与数据库需**成对备份**，避免会话引用与内容不一致。
- **容量检查**：验收后磁盘 23G/40G（57%），私人上下文目录 < 1KB/管理员，后续按管理员数×会话数估算。

## 六、状态汇总

| 类别 | 内容 |
| --- | --- |
| 已通过 | 三服务部署与健康检查、前端公网访问、真实 MySQL 迁移三段验证、并发批准/执行（2 项）、批准前零执行、批准不伪报、重复批准幂等、篡改与旧版本拒绝、撤权拒绝、租约签发/伪造拒绝/过期接管/旧 epoch 失效、并发执行单次副作用、私人上下文持久化/隔离/冲突/损坏/删除/清空、备份恢复演练、后端 693 passed/20 skipped + ruff + 5 契约、Agent 404 passed + tsc/eslint、前端 506 passed + tsc/eslint/rules、两端生产构建 |
| 失败 | 无（发现的 4 个缺陷已修复并回归） |
| 未执行（需后续环境/授权） | 进程强杀类崩溃注入、审计/通知写入失败注入、取消/过期/执行竞争、结果未知转人工、chat/MCP/patrol/approved_worker 真实入口绕过验证、真实模型冒烟、HTTPS + Secure Cookie + SSE（反代）、符号链接逃逸、生产 mysqldump 备份 |
| 待人工确认 | ① 补丁包 `docs/审查记录/GL隔离验收修复/` 的合入拆分与提交方式（用户已同意方案，等待评审执行）；② 是否接受 MySQL 8.0.45 替代 compose 中的 8.4；③ GL-02B/GL-06 剩余项与管理端「模型/外部密钥配置页」的实现排期 |

> 演示环境当前状态：三端各占 3000/3010/3020；Agent 执行器开启以便审批后自动执行；已补充演示课程与问答数据，**未删除任何既有记录**；代码改动仅限第四节 4 处修复，未重构既有功能。

## 七、复现入口

```bash
cd /opt/campus-overflow-test/repo/campus-overflow-ai/backend
set -a; . /opt/campus-overflow-test/env/backend.env; . /opt/campus-overflow-test/env/agent.env; set +a
.venv/bin/python /opt/campus-overflow-test/e2e/gl_e2e.py      # 批准前零执行 / 批准 / 幂等 / 关闭态
.venv/bin/python /opt/campus-overflow-test/e2e/gl_e2e2.py     # 租约 / 错误 epoch / 并发幂等 / 撤权 / 篡改
.venv/bin/python /opt/campus-overflow-test/e2e/ctx1.py ctx2.py ctx3.py  # 私人上下文
```
