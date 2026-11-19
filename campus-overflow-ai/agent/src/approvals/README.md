# 审批协调

2026-10-30：GL-03/04/07/05已接线，旧v1和新v2并存。`GOVERNANCE_EXECUTOR_ENABLED=true`时创建v2申请，人类界面只批准冻结调用，专用后台worker通过任务lease执行；默认关闭。approve成功不等于已执行，结果未知先核对，不创建替代动作。

- `v2.ts`：版本化批准结果；旧等待读取可识别v2，不能转旧resolve。
- `continuation.ts`：固定2/5/10秒核对预算，不恢复任意模型计划。
- `../tools/approved-actions.ts`：只供approved_worker的高风险工具，模型和MCP不注册。
- `../scheduler/governance-executor.ts`：5秒串行领取，180秒活动上限，后端240秒租约及epoch隔离。

运行配置、限制和验证见根目录`docs/Agent层验证记录/GL-04后台执行器.md`、`GL-05审批界面与批次收尾.md`。真实MySQL与杀进程恢复验收仍待GL-06。

AP-02A 已实现管理员治理只读预览：POST `/agent/approvals/preview`。
AP-02B 已实现持久申请：POST `/agent/approvals/requests`。

- `types.ts`：输入、目标和后端状态契约。
- `policy.ts`：动作/目标状态策略与拟动作影响；不替代后端完整授权。
- `preview.ts`：查询 AP-01 后端真实状态，组合事实与建议。
- `requests.ts`：校验申请并经用户凭证提交后端，返回真实工单状态。

预览要求后端确认的管理员身份，后端状态请求继续携带服务凭证与用户凭证。
不调用模型、创建工单或执行治理；结果始终 requires_confirmation=true、executed=false。
普通用户子 Agent 工具集不注册此管理入口；权限不依赖提示词。

申请必须带 request_id（UUID）和预览返回的 state_version（作为 expected_version）。
后端同事务保存申请运行、pending 工单、冻结快照与管理员通知；重复请求返回原工单。
动作、期限或目标版本变化后必须重新申请，不能复用旧确认。
申请成功仅代表已建单；run succeeded 也不代表治理已执行。

AP-03 已实现后端持久等待、GET 结果、POST resume/cancel；默认 7 天，到期/拒绝/取消终止续接。
resume 原子消费后端已执行结果，重复调用不再处置；人工等待期间没有挂起的 HTTP/SSE。
管理端审核队列已有申请面板，管理员治理助手也可提出工单并跳转审批中心确认。
旧v1仍由管理员确认时复用FastAPI治理接口处置；v2由worker在批准后执行冻结调用。两种契约都不能重复执行已完成动作。

教师名单使用独立 class-changes 申请与负责教师确认，不混用管理员治理权限。
模型仅有提议和读结果工具，没有人类确认接口；待审返回后执行器停止后续工具。
当前续接范围为治理结果反馈，不是任意可执行脚本或完整计划运行时序列化。
