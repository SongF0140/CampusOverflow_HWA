# 审批协调

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

AP-03 的执行检查点、挂起与恢复尚未实现；管理端预览/申请界面尚未接入。
实际处置仍由管理员确认后复用 FastAPI 治理接口完成，不能重复执行已完成的动作。
