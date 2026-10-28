# 审批协调

AP-02A 已实现管理员治理只读预览：POST `/agent/approvals/preview`。

- `types.ts`：输入、目标和后端状态契约。
- `policy.ts`：动作/目标状态策略与拟动作影响；不替代后端完整授权。
- `preview.ts`：查询 AP-01 后端真实状态，组合事实与建议。

预览要求后端确认的管理员身份，后端状态请求继续携带服务凭证与用户凭证。
不调用模型、创建工单或执行治理；结果始终 requires_confirmation=true、executed=false。
普通用户子 Agent 工具集不注册此管理入口；权限不依赖提示词。

AP-02B 的持久申请、动作快照和 AP-03 的挂起/恢复尚未实现。
实际处置仍由管理员确认后复用 FastAPI 治理接口完成，不能重复执行已完成的动作。
