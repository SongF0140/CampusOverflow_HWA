# T-12 内部白名单接口测试：服务间鉴权、trace id 透传、运行/工具调用/记忆/工单全链路
# 依据：specs/plan.md §5 八接口、AGENTS.md 硬性约束 1/2（Agent 不直连库、只建工单不执行）、
# US-17/US-18/C-05/C-06/C-07/X-06。测试基建照抄 conftest（SQLite 内存库 + 依赖覆盖）。
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.modules.governance.models import AgentMemory, AgentRun, ModerationCase
from app.modules.identity.models import User

TOKEN = settings.agent_service_token
AUTH = {"X-Service-Token": TOKEN}


def _create_user(db: Session, username: str, role: str = "student", **extra) -> User:
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash=hash_password("pass123456"),
        role=role,
        **extra,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client: TestClient, username: str) -> str:
    resp = client.post(
        "/api/auth/login", json={"account": username, "password": "pass123456"}
    )
    return resp.json()["data"]["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _setup_course_with_question(client: TestClient, db: Session, code: str) -> dict:
    """测试辅助：教师建课、学生加入并发一个带标签的问题（走业务 API 保证状态真实）。"""
    _create_user(db, f"t_{code}", role="teacher")
    teacher_token = _login(client, f"t_{code}")
    course_id = client.post(
        "/api/courses", json={"name": f"计算机网络{code}", "code": code},
        headers=_auth(teacher_token),
    ).json()["data"]["id"]
    _create_user(db, f"a_{code}")
    asker_token = _login(client, f"a_{code}")
    client.post(f"/api/courses/{course_id}/join", headers=_auth(asker_token))
    question_id = client.post(
        "/api/questions",
        json={"title": f"TCP三次握手是什么{code}", "body": "讲解一下握手过程。",
              "course_id": course_id},
        headers=_auth(asker_token),
    ).json()["data"]["id"]
    # 自定义标签名经绑定接口内联创建（发布入参仅收已有标签 id）
    client.post(
        f"/api/questions/{question_id}/tags", json={"tag_ids": ["网络"]},
        headers=_auth(asker_token),
    )
    return {"course_id": course_id, "question_id": question_id}


# ---------- 服务间鉴权（C-05） ----------


def test_missing_token_rejected_401(client: TestClient, db_session: Session) -> None:
    """未带 X-Service-Token 一律 401（完成判定：未带凭证调用被拒绝）。"""
    resp = client.get("/internal/agent/memory", params={"user_id": 1})
    assert resp.status_code == 401
    assert resp.json()["code"] == 401


def test_wrong_token_rejected_401(client: TestClient, db_session: Session) -> None:
    """token 错误一律 401。"""
    resp = client.get(
        "/internal/agent/memory", params={"user_id": 1},
        headers={"X-Service-Token": "bad-token"},
    )
    assert resp.status_code == 401


# ---------- trace id 透传（C-08） ----------


def test_trace_id_passthrough_and_generation(client: TestClient, db_session: Session) -> None:
    """带 X-Trace-Id 时回显并落库；缺省时服务端生成并写入响应头。"""
    _user = _create_user(db_session, "trace_u1")
    # 显式 trace id：响应头回显 + 运行记录落库
    resp = client.post(
        "/internal/agent/runs",
        json={"task_type": "suggest_tags", "input_summary": "为问题推荐标签"},
        headers={**AUTH, "X-Trace-Id": "trace-explicit-001"},
    )
    assert resp.status_code == 200
    assert resp.headers["X-Trace-Id"] == "trace-explicit-001"
    assert resp.json()["data"]["trace_id"] == "trace-explicit-001"
    # 缺省 trace id：服务端生成（32 位 hex）
    resp2 = client.post(
        "/internal/agent/runs",
        json={"task_type": "similar_questions", "input_summary": "相似问题检索"},
        headers=AUTH,
    )
    generated = resp2.headers["X-Trace-Id"]
    assert len(generated) == 32 and generated != "trace-explicit-001"
    run_row = (
        db_session.query(AgentRun).filter(AgentRun.trace_id == "trace-explicit-001").one()
    )
    assert run_row.status == "running"
    assert run_row.agent_run_id  # 后端兜底生成


# ---------- 运行记录与工具调用（US-18） ----------


def test_run_lifecycle_state_machine_and_tool_calls(
    client: TestClient, db_session: Session
) -> None:
    """创建 run → 记 tool call → 终态迁移；终态不可再变更（400），未知 run 404。"""
    resp = client.post(
        "/internal/agent/runs",
        json={"task_type": "moderation_scan", "agent_run_id": "run-001",
              "input_summary": "扫描新内容"},
        headers=AUTH,
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "running"

    # 记录工具调用（参数/结果只传摘要）
    tool_resp = client.post(
        "/internal/agent/tool-calls",
        json={"agent_run_id": "run-001", "tool_name": "search_questions",
              "args_summary": "keyword=TCP", "result_summary": "3 hits",
              "status": "success", "duration_ms": 120},
        headers=AUTH,
    )
    assert tool_resp.status_code == 200
    assert tool_resp.json()["data"]["tool_name"] == "search_questions"

    # running → succeeded
    done = client.patch(
        "/internal/agent/runs/run-001",
        json={"status": "succeeded", "output_summary": "扫描完成，无风险"},
        headers=AUTH,
    )
    assert done.status_code == 200
    assert done.json()["data"]["status"] == "succeeded"

    # 终态不可再迁移
    again = client.patch(
        "/internal/agent/runs/run-001", json={"status": "failed"}, headers=AUTH
    )
    assert again.status_code == 400

    # 未知运行：工具调用与更新均 404
    assert client.post(
        "/internal/agent/tool-calls",
        json={"agent_run_id": "no-such-run", "tool_name": "x", "status": "success"},
        headers=AUTH,
    ).status_code == 404
    assert client.patch(
        "/internal/agent/runs/no-such-run", json={"status": "failed"}, headers=AUTH
    ).status_code == 404


# ---------- 持久化记忆（US-17 / X-06） ----------


def test_memory_write_read_and_sensitive_blocked(
    client: TestClient, db_session: Session
) -> None:
    """写记忆 → 读记忆；敏感内容被拒并零落库；非法类型 400；未知用户 404。"""
    user = _create_user(db_session, "mem_u1")
    headers = {**AUTH, "X-Trace-Id": "trace-mem-001"}

    ok1 = client.post(
        "/internal/agent/memory",
        json={"user_id": user.id, "memory_type": "preference",
              "content": "偏好简短的要点式回答", "source_run_id": "run-001"},
        headers=headers,
    )
    assert ok1.status_code == 200
    ok2 = client.post(
        "/internal/agent/memory",
        json={"user_id": user.id, "memory_type": "course_context",
              "content": "正在修读计网课程，关注 TCP 章节", "course_id": 1,
              "source_run_id": "run-001"},
        headers=headers,
    )
    assert ok2.status_code == 200

    # 读取：按任务类型过滤（suggest_tags → course_context）+ 课程过滤
    filtered = client.get(
        "/internal/agent/memory",
        params={"user_id": user.id, "task_type": "suggest_tags", "course_id": 1},
        headers=headers,
    ).json()["data"]
    assert filtered["total"] == 1
    assert filtered["items"][0]["memory_type"] == "course_context"

    # 不带过滤：全部生效记忆
    all_items = client.get(
        "/internal/agent/memory", params={"user_id": user.id}, headers=headers
    ).json()["data"]
    assert all_items["total"] == 2

    # 敏感内容（密码类关键词）写入被拒且零落库（X-06）
    blocked = client.post(
        "/internal/agent/memory",
        json={"user_id": user.id, "memory_type": "task_experience",
              "content": "用户的密码是123456"},
        headers=headers,
    )
    assert blocked.status_code == 400
    blocked_en = client.post(
        "/internal/agent/memory",
        json={"user_id": user.id, "memory_type": "task_experience",
              "content": "store the api_key here"},
        headers=headers,
    )
    assert blocked_en.status_code == 400
    remain = (
        db_session.query(AgentMemory)
        .filter(AgentMemory.user_id == user.id, AgentMemory.memory_type == "task_experience")
        .count()
    )
    assert remain == 0

    # 非法记忆类型 400；未知用户 404
    assert client.post(
        "/internal/agent/memory",
        json={"user_id": user.id, "memory_type": "secret_notes", "content": "x"},
        headers=headers,
    ).status_code == 400
    assert client.get(
        "/internal/agent/memory", params={"user_id": 999999}, headers=headers
    ).status_code == 404


# ---------- 审批工单（C-06：只建工单，绝不执行处置） ----------


def test_approval_creates_pending_case_without_execution(
    client: TestClient, db_session: Session
) -> None:
    """POST /approvals 只落 pending 工单（source=agent、处置字段为空），目标内容不变。"""
    ctx = _setup_course_with_question(client, db_session, "AP1")
    before = client.get(
        f"/api/courses/{ctx['course_id']}", headers=_auth(_login(client, "t_AP1"))
    ).json()["data"]["aggregates"]["hot_questions"]

    resp = client.post(
        "/internal/agent/approvals",
        json={
            "action_type": "hide_content",
            "risk_level": "high",
            "payload_snapshot": f'{{"question_id": {ctx["question_id"]}, "excerpt": "疑似违规"}}',
            "target_type": "question",
            "target_id": ctx["question_id"],
            "agent_run_id": "run-001",
        },
        headers={**AUTH, "X-Trace-Id": "trace-approval-001"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "pending"
    assert data["source"] == "agent"
    assert data["trace_id"] == "trace-approval-001"
    assert data["risk_level"] == "high"

    case = (
        db_session.query(ModerationCase).filter(ModerationCase.id == data["id"]).one()
    )
    assert case.status == "pending"
    assert case.resolution is None
    assert case.resolved_by is None
    assert case.resolved_at is None

    # 目标内容未被处置：问题仍可见且聚合未变（对比处理前后课程详情）
    after = client.get(
        f"/api/courses/{ctx['course_id']}", headers=_auth(_login(client, "t_AP1"))
    ).json()["data"]["aggregates"]["hot_questions"]
    assert after == before

    # 非白名单动作 / 风险等级 400
    bad = client.post(
        "/internal/agent/approvals",
        json={"action_type": "drop_database", "risk_level": "high",
              "payload_snapshot": "{}"},
        headers=AUTH,
    )
    assert bad.status_code == 400
    bad_risk = client.post(
        "/internal/agent/approvals",
        json={"action_type": "ban_user", "risk_level": "ultra", "payload_snapshot": "{}"},
        headers=AUTH,
    )
    assert bad_risk.status_code == 400


# ---------- 站内检索（US-09 / US-10 / US-12） ----------


def test_courses_search(client: TestClient, db_session: Session) -> None:
    """课程检索：关键词命中名称/编码；空关键词 400。"""
    _setup_course_with_question(client, db_session, "CS1")
    resp = client.get(
        "/internal/agent/courses/search",
        params={"keyword": "计算机网络", "limit": 5},
        headers=AUTH,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1
    assert data["items"][0]["code"] == "CS1"

    assert client.get(
        "/internal/agent/courses/search", params={"keyword": "  "}, headers=AUTH
    ).status_code == 400


def test_questions_search_with_tags_filter(client: TestClient, db_session: Session) -> None:
    """问题候选检索：关键词命中标题/正文；tags 过滤生效；未打标问题被排除。"""
    ctx = _setup_course_with_question(client, db_session, "QS1")
    _create_user(db_session, "t_QS1b", role="teacher")
    teacher_token = _login(client, "t_QS1b")
    course2 = client.post(
        "/api/courses", json={"name": "操作系统QS1b", "code": "QS1b"},
        headers=_auth(teacher_token),
    ).json()["data"]["id"]
    _create_user(db_session, "a_QS1b")
    asker2 = _login(client, "a_QS1b")
    client.post(f"/api/courses/{course2}/join", headers=_auth(asker2))
    client.post(
        "/api/questions",
        json={"title": "进程与线程的区别", "body": "也和TCP协议无关，讲讲进程调度。",
              "course_id": course2},
        headers=_auth(asker2),
    )

    # 关键词命中标题或正文（两条都提到 TCP）
    resp = client.get(
        "/internal/agent/questions/search",
        params={"keyword": "TCP", "limit": 10},
        headers=AUTH,
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["total"] == 2

    # tags 过滤：只保留带"网络"标签的候选（total 为库内命中数，items 为过滤后候选）
    tagged = client.get(
        "/internal/agent/questions/search",
        params={"keyword": "TCP", "tags": "网络"},
        headers=AUTH,
    ).json()["data"]
    assert len(tagged["items"]) == 1
    assert all(
        any(t["name"] == "网络" for t in item["tags"]) for item in tagged["items"]
    )

    # 按课程过滤 + 未知课程返回空集
    by_course = client.get(
        "/internal/agent/questions/search",
        params={"keyword": "TCP", "course_id": ctx["course_id"]},
        headers=AUTH,
    ).json()["data"]
    assert by_course["total"] == 1
    assert client.get(
        "/internal/agent/questions/search", params={"keyword": "  "}, headers=AUTH
    ).status_code == 400


# ---------- 标签词表（US-11 / E-09：T-13 补充端点） ----------


def test_tags_vocabulary_requires_service_token(client: TestClient, db_session: Session) -> None:
    """未带 X-Service-Token 的词表请求一律 401（词表同样走服务间鉴权，不挂用户 JWT）。"""
    resp = client.get("/internal/agent/tags")
    assert resp.status_code == 401
    assert resp.json()["code"] == 401


def test_tags_vocabulary_returns_snake_fields(client: TestClient, db_session: Session) -> None:
    """合法 token 返回站内标签词表：蛇形字段 id/name/type；limit 截断生效。"""
    ctx = _setup_course_with_question(client, db_session, "TV1")
    # 再发一问并绑定第二个标签，构造多标签词表
    asker_token = _login(client, "a_TV1")
    question2 = client.post(
        "/api/questions",
        json={"title": "UDP协议是什么", "body": "讲讲UDP与TCP的区别。",
              "course_id": ctx["course_id"]},
        headers=_auth(asker_token),
    ).json()["data"]["id"]
    client.post(
        f"/api/questions/{question2}/tags", json={"tag_ids": ["并发"]},
        headers=_auth(asker_token),
    )

    resp = client.get("/internal/agent/tags", headers=AUTH)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 2
    assert {item["name"] for item in data["items"]} == {"网络", "并发"}
    for item in data["items"]:
        # 断言蛇形出参且仅暴露词表必需字段（不含 question_count 等列表语义字段）
        assert set(item.keys()) == {"id", "name", "type"}
        assert isinstance(item["id"], int)

    # limit 截断
    limited = client.get(
        "/internal/agent/tags", params={"limit": 1}, headers=AUTH
    ).json()["data"]
    assert limited["total"] == 1
