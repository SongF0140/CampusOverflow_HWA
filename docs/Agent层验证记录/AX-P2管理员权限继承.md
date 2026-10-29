# AX-P2 管理员权限继承验证（2026-10-29）

## 设计依据

用户决定“管理员权限覆盖教师和自己的新权限”，并选择“可管理全站课程／班级，变更仍需管理员本人确认”。依据 specs/spec.md 当前角色修订、specs/plan.md、specs/tasks.md AX-P2、实施前 analyze、Memory M-D12 与 Approvals A-D10。实施计划见 ../superpowers/plans/2026-10-29-admin-inheritance.md。

管理员继承教师业务并保留治理权限：全站课程、知识树、教学计划、名单、经验、课程报告/匿名反馈、教学认证及助教资格审核。实际身份保持 admin，不伪装成课程负责教师。用户私人记忆、聊天、运行归属隔离；教师范围保持本人课程。

## 验证记录

先观察新增管理员跨课程用例、角色工具与前端入口在旧权限下失败，再修正实现。旧“其他教师”负例夹具实际配置为管理员，已改为真正的其他教师，继续验证其被拒绝。

- 后端相关回归：`pytest tests/test_admin_inheritance.py tests/test_class_change_requests.py tests/test_experiences.py tests/test_courses.py tests/test_knowledge_tree.py tests/test_identity.py tests/test_trusted_learning.py tests/test_agent_run_ownership.py tests/unit/test_identity_domain.py -q`：152 passed。
- 后端补充：`pytest tests/test_admin_inheritance.py tests/test_qa_answers.py::test_certify_by_course_teacher tests/test_weekly_report.py::test_weekly_report_teacher_private tests/test_answer_certification.py tests/test_external_agent_identity.py -q`：37 passed。与前一组有重叠，不合计为不重复用例数。存在2项已有依赖弃用警告。
- 后端 `ruff check .` 通过，`lint-imports` 5条契约通过。
- Agent：`vitest run tests/role-action-tools.test.ts tests/mcp-admin.test.ts tests/main-agent-control.test.ts tests/approval-waits.test.ts tests/user-auth.test.ts`：5文件50项通过；`tsc --noEmit`、`eslint .` 通过。
- 前端：TeacherCourseList、TeacherWorkspaceView、QuestionDetailView、AdminShell、CourseManageView、api/endpoints相关6文件75项通过；`tsc --noEmit`、`eslint .` 通过。
- 覆盖管理员跨课程名单申请/确认、重复确认不重放、审计真实确认人、经验发布、报告与匿名反馈、认证与发问；外部密钥只提议，不能调用人类确认/发布接口；旧工具引用、恶意主规则不能突破角色边界；私有运行归属回归通过。

## 决策说明

- 采用统一 admin→teacher 角色继承并补对象权限，避免仅显示入口后仍被后端拒绝。无 admin→student 或自动助教继承。
- 主规则的管理员有效工具为教师实际获准工具与管理员规则的并集，仍受固定角色能力上限及实时身份复核限制。教师规则错误声明治理工具不会经继承生效。
- 管理员教学入口显示全部课程；认证沿用 `certified_by_teacher` 教学类别字段，文案说明包含管理员，没有新增认证历史结构或迁移。
- 课程报告的管理员访问明确覆盖旧 E-14 限制；个人聊天/记忆不在教学管理范围。
- 外部MCP新增教学提议/读取工具；JWT确认与发布不注册模型工具。后台服务凭证与外部密钥不替代人类批准。
- 本轮未推送、部署、执行真实业务变更或调用真实模型；以上为自动化相关回归，不代表完整系统全量测试或用户运行体验。
