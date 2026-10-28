# AP-02A 管理员治理预览

日期：2026-10-28。实现验证通过，人工待审查。

## 设计依据

- 用户“继续完成”授权承接 AP-01，沿当前任务顺序推进。
- 已读取 AGENTS.md、宪法、spec AX-R05/AX-R08、plan AP-02A、tasks/analyze、Approvals 设计 A-D01/A-D03/A-D05、Memory 主子 Agent 权限边界、AP-01 计划及验证记录、编码与目录规则。
- 采用 writing-plans/TDD：先细分 AP-02A 预览与 AP-02B 持久申请，防止将无快照预览当作执行批准。

## 实现

- POST /agent/approvals/preview：沿用后端身份解析，仅允许当前 active 管理员；再次通过 AP-01 双凭证接口读取状态。
- 输入：target_type、target_id、action、reason，可选 duration_days。内容动作 hide/delete；用户动作 ban/ban_temp/warn。期限仅 ban_temp 可用，默认 7 天，整数 1～30。额外 role/user_id/tool_name 等字段拒绝。
- 返回当前状态、拟动作影响、能否提出申请与阻止原因，requires_confirmation 恒 true、executed 恒 false，并带 trace_id、no-store。
- 状态判定：ready 内容可建议 hide/delete；hidden 可建议 delete；missing/deleted 阻止；用户 active 可提出用户处置建议，banned/missing 阻止。不代表最终可执行，例如管理员账号保护仍需后端复核。
- UserInternalClient 新增固定 user 路径的方法；服务级客户端无用户凭证时在请求前拒绝，不回退服务特权。响应目标 ID/类型或状态类别错配拒绝，后端错误脱敏。
- approvals/types.ts、policy.ts、preview.ts 承担契约、确定性策略与预览装配；routes/approvals.ts 只处理 HTTP。未注册到普通子 Agent 工具表，不改变原任务规划。

## 验证记录

- 先运行新增测试：40 failed/1 passed，失败因预览路由与客户端方法缺失；已通过项为原有未登录中间件。
- `node node_modules/vitest/vitest.mjs run tests/approvals-preview.test.ts tests/user-auth.test.ts tests/user-tools.test.ts tests/integration-run.test.ts`：4 文件 66 passed（新增 41）。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node node_modules/eslint/bin/eslint.js .`：通过。
- mock fetch 仅允许后端 principal/state 的 GET，任何写入失败；模型调用即抛错。覆盖真实 app+真实客户端的双凭证/trace、非管理员拒绝、非法参数、动作目标错配、期限、状态策略、错目标响应、撤权及错误脱敏。
- 无后端修改、无迁移、未执行真实治理。本轮未运行无关前端/后端或全量 Agent 测试；按仓库开发期相关冒烟规则执行。

## 决策与限制

- 预览由程序解释后端事实，不需模型评价或生成；原因字段为调用方建议，不能改变授权策略。
- 未持久化工单、未返回等待状态、未实现批准/执行/恢复，不把本块称为完整 approvals。管理端预览界面尚未接入。
- 预览不是签名批准或冻结版本凭证，不能直接提交任意旧预览执行。AP-02B 需固化参数/观察版本并复核，AP-03 处理持久等待及结果续接。
- AP-01 只返回目标自身状态，本块不补出未经查询的父级状态、账号角色或权限；完整治理规则仍在后端。
- 请求通过 trace 与现有后端调用日志可关联；本块不创建模型运行或虚构处置审计。后台巡检、前台聊天与 MCP 原有行为不变。
