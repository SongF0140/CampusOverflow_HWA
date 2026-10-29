# AP-02B 持久审批申请 Implementation Plan

**Goal:** 基于版本化预览提交可重试的 pending 工单，防止参数替换、旧状态确认与重复建单。

**Architecture:** Agent 校验并转发 → 后端锁目标/校验版本 → 唯一申请 run、冻结工单和通知同事务提交；现有管理员处置入口复核冻结契约。无需新表、依赖或迁移。

**Tech Stack:** 现有 Hono/Zod、FastAPI/Pydantic、SQLAlchemy、Vitest/pytest。

## Constraints

子 Agent 只读，不接入执行工具；后端鉴权，不依赖提示词；资料/用户隐私不输出；旧工单兼容；人工等待与续接归 AP-03。

## 单一交付块

- [x] 先写 backend/tests/test_approval_requests.py 反例：版本读取、重复申请、替换参数、角色/双凭证拒绝、状态/正文变更、执行动作/期限冻结、拒绝与旧工单兼容、通知异常整体回滚、终态不重放。
- [x] 运行 pytest 确认缺版本字段/新接口失败，再实现。
- [x] qa.service 提供目标自身只读快照，repository 支持 for_update；identity.service 提供可选锁定的最小治理快照。governance.service_approvals 哈希快照，schema 增 opt-in state_version。
- [x] 定义 FrozenApprovalSnapshot 和 GovernanceRequestCreate/Out 严格边界，复用 domain 动作匹配与期限规则。请求标识采用 UUID，expected_version 为 64 位十六进制。
- [x] get_case_by_run_id 查唯一申请关联工单；AgentRun 唯一键处理并发重复，IntegrityError 后仅当同申请已存在才读取原结果，否则继续报错。建单、run 成功和通知一次提交，异常回滚。
- [x] 现有 update_case_agent_decision 锁工单并检查冻结快照/目标版本；任何被篡改/缺失的新格式快照拒绝。skip 不需要目标仍存在，以便管理员安全拒绝。
- [x] Agent 新增版本获取、请求输入/ack 契约、submitGovernanceRequest 和 requests 路由；后端冲突返回脱敏 409。预览/申请均不调用模型与处置。
- [x] 增加 Agent 真实路由/客户端反例，先红后绿；回归审批预览、身份、工具与集成测试；后端审批/治理专项，两个服务 lint、Agent tsc、后端分层契约。
- [x] 回填 tasks/analyze/验证记录，git diff --check；中文提交后按 AGENTS 停在审查点。MySQL 并发专项是否可运行据环境记录，不擅自访问真实业务库。

接口：state 查询 include_version=true 返回 state_version；POST governance-requests 输入为 action/target/reason/duration_days/request_id/expected_version，输出 request_id/case_id/agent_run_id/status/repeat/target/action/duration_days。申请成功不是治理成功。

关键测试：同一请求两次响应 case_id、agent_run_id 一致且通知不增加；首次建单后正文改动，管理员 resolve 返回 409 且内容和 pending 工单不被处置；正确版本/动作只执行一次，重复 resolve 保持终态错误。
