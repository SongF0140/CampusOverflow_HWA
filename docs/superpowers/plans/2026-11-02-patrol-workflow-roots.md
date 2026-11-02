# WF-03A 系统巡检根任务实施计划

用户选择：后台巡检自动发起。按executing-plans/TDD在当前会话推进，不委派子Agent；本块验证提交后按AGENTS.md等待审查。

**Goal:** 创建系统巡检的固定范围根任务，避免冒用管理员和重复巡检重置任务。

**Architecture:** FastAPI新增POST/GET /internal/agent/patrol/workflow-tasks（GET带task_id），服务凭证鉴权，默认新开关关闭。后端读取实际内容版本并以type/id/version去重，同事务创建根任务和AgentRun；不创建审批或处置。

**Tech Stack:** 现有FastAPI/Pydantic/SQLAlchemy/Alembic，MySQL业务真值，SQLite隔离验证；无新依赖。

## 文件与步骤

- models.py与新迁移wf03a_patrol_roots：根任务id、目标、初始版本、source_key唯一、trace_id、agent_run_id、created_at；不含用户凭证、原文或轮次。
- schemas_workflow.py：strict请求仅target_type（question/answer/comment）、target_id；服务器固定system_patrol、scope和审计标识。
- repository.py：按source_key/task_id读取及flush创建。
- service_workflow.py：现状复核、服务端UUID、同事务审计/根任务，唯一冲突回读，失败回滚。
- router_workflow.py与main.py：服务凭证、默认关闭开关、创建和读取，不注册为模型/MCP工具。
- tests/test_patrol_workflow_roots.py：先验证缺路由红灯；覆盖默认关闭、无效凭证、伪造身份/范围字段、重复同版本、实际版本变化、审计归属、缺失/已隐藏目标、创建失败回滚、零审批/处置。

执行相关pytest、ruff check .、lint-imports；迁移使用临时SQLite URL执行upgrade head→downgrade gl04_job_resume→upgrade head，不使用默认真实连接。记录测试/迁移限制，回填tasks/analyze和审查记录，仅提交本块变更，保留既有GL验收文件。

自审：A是B/C/D前置契约，不标为完整WorkflowAgent交付；原工单和执行器行为不变，真正后台触发接线在D完成。
