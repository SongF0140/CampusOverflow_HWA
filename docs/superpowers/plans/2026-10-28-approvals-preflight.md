# AP-01 管理员治理现状读取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 当前在本会话内执行，不派发子代理。步骤使用复选框跟踪。

**Goal:** 在人工确认前，让 Agent 经双鉴权读取治理目标真实当前状态，读取不执行治理或解禁。

**Architecture:** 复用 FastAPI 内部白名单与数据库当前管理员依赖；governance 查询服务通过 qa/identity 公共 service 读取，返回最小状态。审批创建、等待、执行和恢复属于后续块。

**Tech Stack:** Python ≥3.11、FastAPI、Pydantic、SQLAlchemy 同步；pytest/ruff/import-linter。

## Global Constraints

- Agent 不直接连 MySQL；接口字段蛇形；中文响应；不输出邮箱、凭证或正文。
- 身份取后端当前数据库，服务凭证不能单独替代管理员；保持教师助教审核例外。
- 不调用 moderation_probe_user，因为该函数会惰性解禁；无迁移、不改业务状态机。

## Task 1：只读现状接口（本块唯一交付）

**Files:**
- Create: campus-overflow-ai/backend/tests/test_agent_governance_state.py
- Create: campus-overflow-ai/backend/app/modules/governance/service_approvals.py
- Modify: campus-overflow-ai/backend/app/modules/governance/schemas.py
- Modify: campus-overflow-ai/backend/app/modules/governance/router_internal.py

**Interfaces:**
- GET /internal/agent/user/governance-targets/{target_type}/{target_id}/state
- 输入：X-Service-Token、Bearer 管理员 JWT、可选 X-Trace-Id；target_type=question/answer/comment/user，target_id≥1。
- 输出：{code:200,data:{target_type,target_id,current_state},message:"success"}。
- 内容状态复用 ready/missing/deleted/hidden；用户状态 active/banned/missing。只报告目标自身状态，不表示整个父级链可见、动作获准或未来执行必然成功。
- service 函数：get_target_state(db: Session, target_type: str, target_id: int) -> GovernanceTargetStateOut。

- [x] **Step 1: Write failing tests.**
  - 缺/错服务 token，缺/错登录 token，普通学生/教师、封禁管理员均拒绝。
  - JWT 声称 admin、DB 已降权时拒绝；DB 升为 admin、JWT 旧角色仍按 DB 放行。
  - 问题、回答、评论的 ready/hidden/deleted 及四类 missing 均如实返回。
  - 用户 active/banned 如实返回；过期临时封禁也不在读取时改变。
  - 正文、邮箱、密码哈希、封禁原因不进入响应；读不增加浏览量，不执行 INSERT/UPDATE/DELETE。

  核心断言示例：
  ```python
  response = client.get(path, headers=admin_headers)
  assert response.status_code == 200
  assert response.json()["data"] == {
      "target_type": "question", "target_id": question.id, "current_state": "hidden",
  }
  assert response.headers["X-Trace-Id"] == "state-check"
  ```

- [x] **Step 2: Verify red.**
  Run backend/.venv/Scripts/python.exe -m pytest tests/test_agent_governance_state.py -q（在 backend 目录）；新增路由不存在，应因 404/契约断言失败。

- [x] **Step 3: Implement schemas, service and route.**
  Schema：target_type 与 current_state 均用 Literal 限定；服务内容分支调用 qa_service.probe_moderation_target，用户分支调用 identity_service.get_by_id，捕获 UserNotFoundError 返回 missing。路由添加 ServiceAuth 与 require_roles("admin")，只调用 service，不接触 ORM。
  ```python
  def get_target_state(db: Session, target_type: str, target_id: int) -> GovernanceTargetStateOut:
      if target_type == "user":
          try:
              state = identity_service.get_by_id(db, target_id).status
          except identity_domain.UserNotFoundError:
              state = "missing"
      else:
          state = qa_service.probe_moderation_target(db, target_type, target_id)
      return GovernanceTargetStateOut(
          target_type=target_type, target_id=target_id, current_state=state,
      )
  ```

- [x] **Step 4: Verify green and relevant regression.**
  Run .venv/Scripts/python.exe -m pytest tests/test_agent_governance_state.py tests/test_agent_principal.py tests/test_agent_moderation_content.py -q；再运行 .venv/Scripts/ruff.exe check . 与 .venv/Scripts/lint-imports.exe。失败按实际原因修复，记录测试数量；无表结构变更，不跑业务数据库迁移。

- [x] **Step 5: Record and commit.**
  回填 specs/tasks.md、specs/analyze.md 与 docs/Agent层验证记录/AP-01治理现状.md；git diff --check；只提交本批明确文件，中文提交 feat: 增加管理员治理现状只读接口。完成本块按 AGENTS 停下审查，不自动推进 AP-02。

验证结果：26 项先红；最终相关 76 passed，ruff 通过，import-linter 5 kept。入参错误按 core/errors.py 的统一契约返回 400；无迁移。最终提交状态见本块验证记录与 Git 历史。
