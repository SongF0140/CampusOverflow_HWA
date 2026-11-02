# WF-03B/C/D至WF-04连续实施计划

> 使用executing-plans与TDD在当前会话执行，不启动子Agent。用户授权“一直做到w4”，每块验证本地提交，批末集中审查，不推送或部署。

**Goal:** 接通系统巡检→持久模型闭环→逐次审批/执行→最多五轮，并验证故障恢复。

**Architecture:** FastAPI管理根任务范围、系统冻结申请与原子执行。Workflow持久化编排，WorkflowAgent分别规划动作与评估新观察，独立五轮状态控制。旧worker按来源隔离；租约只在执行步骤内部使用。Postgres只存运行数据。

**Tech Stack:** 现有Python/TypeScript、AI SDK7/Workflow5，新增同代Postgres World；独立临时数据库和模型HTTP替身测试。

## B：后端审批与执行归属

文件：schemas_executions/workflow、models、repository、service_executions/execution_actions/execution_jobs/workflow、router_workflow、迁移；Agent approved-actions解析与前端v2类型。

- [ ] 先写system申请→人类批准→旧claim拒领→定向claim→execute幂等回执的反例，覆盖越界目标、篡改参数、撤权、关闭开关、重复申请、旧admin契约。
- [ ] 系统申请字段requester_id=null、workflow_task_id=根UUID；冻结schema/哈希保留旧格式。后端派生作者目标，不接任意target。
- [ ] POST根/{id}/proposals接动作、原因、轮次和稳定UUID；GET申请读取与到期；POST定向claim需executor身份，原execute共用网关/原子业务事务。
- [ ] 根任务增加run_id绑定、终态与关闭原因，补偿未绑定根；终态阻止后续申请及执行。
- [ ] 相关pytest、ruff、分层契约、隔离增量迁移通过后提交B。

## C：Postgres World与内部路由

文件：package/lock、runtime配置、Nitro plugin、内部loopback代理、workflow-access策略与测试、隔离冒烟脚本。

- [ ] 核对npm依赖版本，安装同发布周期World。测试启动一次、关闭清理、数据库URL必填、生产不能降级Local World。
- [ ] World内部回调使用专用loopback端口；对外端口拒绝/.well-known/workflow，代理只转发精确内部前缀并注入服务器临时凭据，外部自报头不能放行。
- [ ] World工作进程启动/关闭归服务器生命周期；不记录URL或凭证。
- [ ] 专用临时Postgres验证真实步骤持久化，提交C。

## D：模型五轮闭环

文件：workflow客户端、根任务调度/dispatch、src/workflows治理函数/步骤、规划与评估schema、运行预算及Agent测试。

- [ ] 先写轮内多动作、5轮停止、审批待审、未知不重做、无进展、预算累计和重复启动的反例。
- [ ] 巡检入口开关启用后走根任务dispatch，不再创建旧巡检工单；原开关关闭仍旧行为，互不混用。
- [ ] 原子start hook按根task_id去重；根绑定及未绑定补偿，失败重试不新建根。
- [ ] 每轮WorkflowAgent.generate规划动作，服务端步骤查询审批；等待用workflow sleep释放连接。执行步骤不返回租约；复读状态后WorkflowAgent评估，由WF-01推进轮次。
- [ ] 工具调用与活动时间累计，模型单次超时有限，人工等待7天独立；拒绝/过期/取消/未知终止并反馈。
- [ ] 相关单测、typecheck/lint、真实workflow模型替身冒烟，提交D。

## WF-04：故障验收与收口

- [ ] 在临时实例验证多动作5轮、批准前零执行、批准后一次、重复事件、跨重启轮数不重置、响应丢失与原回执、撤权/审计失败阻断。
- [ ] 测试专用MySQL锁/原子回滚与Postgres重启恢复，不使用默认业务库；仅终止测试脚本创建的进程。
- [ ] 本地批次全量检查；记录模型替身与真实模型的区别、数据库类型和所有未跑项目。无真实证据不勾整体完成。
- [ ] 更新spec/plan/tasks/analyze、依赖与运行文档、审查/验证记录；提交WF-04，报告结果及限制。
