# AX-C 教师审核回答经验计划

用户决策：Agent 提交经验建议，老师确认后发布。按负责课程隔离是本批工程边界：学生仅能在已加入课程提建议/读已发布经验，教师仅负责课程；管理员/外部密钥不能代替老师发布。

## 设计

新增 agent_experiences 表：UUID 建议标识、课程、提议者、标题/摘要/步骤、pending/published/rejected/withdrawn、审核人/时间、trace 与申请运行 ID。单次建议使用唯一 proposal_id 去重，参数替换或换账号复用 409；与申请运行同事务。学生上下文只读取已发布版本，撤回后不再披露。建议不接收私人消息、记忆或工具规则字段，保守拒绝敏感词与明显联系方式；不自动从私人聊天生成建议。

后端 router_experiences：双凭证 POST /internal/agent/user/experience-proposals；当前课程用户 GET /internal/agent/user/courses/{id}/experiences；负责教师 GET /api/agent-experiences/courses/{id}/proposals 与 POST /api/agent-experiences/{id}/{publish,reject,withdraw}。决策锁定行，同动作重试幂等，禁止从终态拒绝/撤回再次发布。教师界面列出摘要与步骤，明确点击后发布，支持拒绝/撤回和错误态。

- [ ] 后端反例：未发布不披露、重复提交、参数替换、课程/角色隔离、双凭证、发布/拒绝/撤回幂等、敏感/额外字段、撤权。
- [ ] schema、model/repository、service/router 与独立迁移 ax_c_experiences（接 ax_t_learning）。
- [ ] 最小教师页面及交互测试。
- [ ] pytest/Vitest、lint/类型/分层，隔离数据库迁移验证；父任务统一接线、提交与规格更新。
