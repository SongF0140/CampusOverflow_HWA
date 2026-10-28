# AP-02B 持久审批申请

日期：2026-10-28。实现验证通过，人工待审查。

## 设计依据

- 用户“继续完成”授权承接 AP-02A；依据 AGENTS、宪法、spec AX-R05/AX-R08、Approvals A-D01/A-D03/A-D05、Memory 主子 Agent 权限边界及现有治理状态机。
- 实施前读取 plan/tasks/analyze、Approvals 设计、AP-01/AP-02A 验证记录、编码与目录规则；详细计划见 docs/superpowers/plans/2026-10-28-approvals-requests.md。
- 沿用后端工单，不引入第二套审批真值源；本块仅预览版本化、持久申请和执行冻结校验，AP-03 负责等待与续接。

## 实现与契约

- 状态读取增加 include_version=true 选项，返回 SHA-256 state_version；缺省响应兼容 AP-01。原始正文、角色与封禁原因等内部版本材料不对外输出。
- Agent 预览必须获得合法版本；POST /agent/approvals/requests 经真实用户客户端调用 POST /internal/agent/user/governance-requests。
- 输入严格限定 request_id UUID、expected_version、target_type/target_id、action、reason、可选 duration_days；限时封禁默认 7 天、1～30，仅 ban_temp 可指定期限。
- 后端再次检查服务凭证与数据库当前管理员身份，锁目标复核状态/版本，保存 pending 工单、冻结快照、申请运行和管理员通知后一次提交。异常整体回滚。
- 复用 agent_runs.agent_run_id 唯一约束，固定 approval-{UUID}，不新增表或迁移。同管理员、同 ID、同参数重试返回原工单；参数或申请人替换返回 409；唯一约束冲突后回滚并读取既有结果。
- 现有决策入口对新工单锁定读取并校验冻结契约，目标正文/状态变化、动作/期限替换或新工单快照损坏均拒绝；skip 可安全拒绝过时工单。旧格式工单兼容。
- 实际处置仍走原管理员治理 API。重复申请已执行工单仅返回 executed 状态，不再处置；Agent 不调用执行工具或模型。
- 申请 run succeeded 只表示建单成功，工单状态仍为 pending；不把工单创建误标为治理执行成功。

## 验证记录

- 后端先写 25 项反例并观测失败，原因是版本字段和新接口缺失；实现后补充唯一键冲突回读与预览后管理员撤权两项，共新增 27 项。
- `.venv/Scripts/python.exe -m pytest tests/test_approval_requests.py tests/test_agent_governance_state.py tests/test_moderation_center.py tests/test_governance_notify.py tests/test_governance_internal.py tests/test_ban_temp_warn.py tests/test_moderation_patrol.py -q`：126 passed，2 条既有依赖弃用警告。
- Agent 新反例先 20 failed/40 passed，再实现后运行 `node node_modules/vitest/vitest.mjs run tests/approvals-preview.test.ts tests/user-auth.test.ts tests/user-tools.test.ts tests/integration-run.test.ts`：4 文件 85 passed，其中审批预览/申请 60 项。
- `node node_modules/typescript/bin/tsc --noEmit`、`node node_modules/eslint/bin/eslint.js .`：通过。类型检查曾发现共享路由 handler 使用预览专有客户端类型，已改为明确的公共依赖类型并复验。
- `.venv/Scripts/ruff.exe check .`：通过；`.venv/Scripts/lint-imports.exe`：5 kept、0 broken。
- 覆盖服务/用户凭证缺失、非管理员、撤权、非法字段、响应错配、版本变化、动作/期限冻结、重复/终态请求、拒绝、通知失败回滚、旧治理流程兼容。浏览计数变化不使版本失效，正文变化使版本失效。

## 决策与限制

- 无真实业务库迁移、真实治理或真实模型调用；没有新增高风险子 Agent 工具。
- SQLite 测试覆盖功能与真实唯一约束冲突回读；冲突测试模拟首次读取未命中，不等价于 MySQL 多连接并发专项。行锁正确性仍需隔离 MySQL 环境验证。
- 版本只覆盖目标自身相关字段，不包含父问题状态或全部授权条件；最终后端治理授权和目标校验仍保留。
- 原 resolve 是分步提交状态机，本块未重构整个 resolve/结果通知事务边界；仅保证新申请创建的 run、工单、通知同事务。
- 管理端预览/申请界面、会话检查点、释放连接后的自动续接、取消/过期和巡检与会话的续接协调尚未实现，归后续任务。当前普通工具集仍只读。
