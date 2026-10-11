# T-12 内部白名单接口测试：服务间鉴权、trace id 透传、运行/工具调用/记忆/工单全链路
# 依据：specs/plan.md §5 八接口、AGENTS.md 硬性约束 1/2（Agent 不直连库、只建工单不执行）、
# US-17/US-18/C-05/C-06/C-07/X-06。测试基建照抄 conftest（SQLite 内存库 + 依赖覆盖）。
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.modules.courses.models import Course
from app.modules.governance.models import AgentMemory, AgentRun, ModerationCase
from app.modules.identity.models import User, UserStatusAudit
from app.modules.qa.models import Answer, Comment, Question, QuestionTag, Tag

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

    # tags 过滤：items 与 total 均只统计带“网络”标签的问题
    tagged = client.get(
        "/internal/agent/questions/search",
        params={"keyword": "TCP", "tags": "网络"},
        headers=AUTH,
    ).json()["data"]
    assert len(tagged["items"]) == 1
    assert tagged["total"] == 1
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


@pytest.fixture
def question_search_data(db_session: Session) -> dict:
    user = _create_user(db_session, "search_filter_teacher", role="teacher")
    courses = [
        Course(name=f"检索课程{i}", code=f"FILTER{i}", teacher_id=user.id)
        for i in range(2)
    ]
    tags = [Tag(name="网络"), Tag(name="并发")]
    db_session.add_all([*courses, *tags])
    db_session.flush()
    now = datetime(2026, 10, 8, 12)
    rows = [
        ("network_old", 0, "TCP旧问题", "正文", [0], False),
        ("concurrency", 0, "正文命中", "TCP正文", [1], False),
        ("both", 0, "TCP双标签", "正文", [0, 1], False),
        ("untagged", 0, "TCP无标签", "正文", [], False),
        ("other_course", 1, "TCP其他课程", "正文", [0], False),
        ("other_keyword", 0, "UDP问题", "正文", [0], False),
        ("deleted", 0, "TCP已删", "正文", [0], True),
        ("untagged_new", 0, "TCP最新无标签", "正文", [], False),
    ]
    ids = {}
    for index, (key, course, title, body, tag_indexes, deleted) in enumerate(rows):
        question = Question(
            title=title, body=body, course_id=courses[course].id, author_id=user.id,
            created_at=now + timedelta(minutes=index),
            deleted_at=now if deleted else None,
        )
        db_session.add(question)
        db_session.flush()
        ids[key] = question.id
        db_session.add_all([
            QuestionTag(question_id=question.id, tag_id=tags[i].id) for i in tag_indexes
        ])
    db_session.commit()
    return {"ids": ids, "course_id": courses[0].id}


@pytest.mark.parametrize(
    ("tags", "limit", "expected", "total"),
    [
        ("网络", 1, ["other_course"], 3),
        (" 网络, 并发,网络, , ", 2, ["other_course", "both"], 4),
        ("并发", 10, ["both", "concurrency"], 2),
        ("不存在", 1, [], 0),
        ("网", 10, [], 0),
        ("", 1, ["untagged_new"], 6),
        (" , , ", 1, ["untagged_new"], 6),
        (None, 1, ["untagged_new"], 6),
    ],
)
def test_questions_search_tags_before_limit_and_count(
    client: TestClient, question_search_data: dict,
    tags: str | None, limit: int, expected: list[str], total: int,
) -> None:
    params = {"keyword": "TCP", "limit": limit}
    if tags is not None:
        params["tags"] = tags
    response = client.get("/internal/agent/questions/search", params=params, headers=AUTH)
    assert response.status_code == 200
    data = response.json()["data"]
    assert [item["id"] for item in data["items"]] == [
        question_search_data["ids"][key] for key in expected
    ]
    assert data["total"] == total


def test_questions_search_tags_combined_course_keyword_and_soft_delete(
    client: TestClient, question_search_data: dict,
) -> None:
    response = client.get(
        "/internal/agent/questions/search",
        params={"keyword": " TCP ", "course_id": question_search_data["course_id"],
                "tags": "网络,并发", "limit": 2},
        headers=AUTH,
    )
    assert response.status_code == 200
    data = response.json()["data"]
    ids = question_search_data["ids"]
    assert [item["id"] for item in data["items"]] == [ids["both"], ids["concurrency"]]
    assert data["total"] == 3


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


# ---------- 工单决策（T-16 双环工作流状态机） ----------

def _create_moderation_case(
    db: Session,
    status: str = "pending",
    target_type: str = "question",
    target_id: int = 1,
    **kwargs,
) -> ModerationCase:
    """创建测试用工单."""
    case = ModerationCase(
        target_type=target_type,
        target_id=target_id,
        status=status,
        source="agent",
        agent_run_id="run-test-001",
        trace_id="trace-test-001",
        risk_level="high",
        resolution=None,
        reason="test case",
        **kwargs,
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


def _admin_jwt_headers(
    client: TestClient, db: Session, username: str = "admin_dec"
) -> tuple[dict, int]:
    """创建管理员并返回 (JWT 请求头, 用户 id)。"""
    admin = _create_user(db, username, role="admin")
    return _auth(_login(client, username)), admin.id


def _student_jwt_headers(client: TestClient, db: Session, username: str = "stu_dec") -> dict:
    """创建学生并返回 JWT 请求头。"""
    _create_user(db, username)
    return _auth(_login(client, username))


def test_decide_missing_credentials_returns_401(client: TestClient, db_session: Session) -> None:
    """既无 JWT 也无服务 token 一律 401。"""
    case = _create_moderation_case(db_session, status="pending")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "x", "decision": "hide"},
    )
    assert resp.status_code == 401


def test_decide_invalid_jwt_returns_401(client: TestClient, db_session: Session) -> None:
    """携带 Authorization 但 JWT 非法：直接 401，不回退服务 token。"""
    case = _create_moderation_case(db_session, status="pending")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "x", "decision": "hide"},
        headers={"Authorization": "Bearer not-a-valid-token", **AUTH},
    )
    assert resp.status_code == 401


def test_decide_student_jwt_returns_403(client: TestClient, db_session: Session) -> None:
    """学生 JWT 即使合法也无权操作决策接口。"""
    case = _create_moderation_case(db_session, status="pending")
    headers = _student_jwt_headers(client, db_session)
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "x", "decision": "hide"},
        headers=headers,
    )
    assert resp.status_code == 403


def test_decide_after_missing_case_returns_404(client: TestClient, db_session: Session) -> None:
    """不存在的工单返回 404."""
    resp = client.patch(
        "/internal/agent/moderation-cases/999999/decision",
        json={"manager_feedback": "test", "decision": "hide", "skip_reason": "n/a"},
        headers=AUTH,
    )
    assert resp.status_code == 404


def test_decide_terminated_state_cannot_be_updated(client: TestClient, db_session: Session) -> None:
    """终态工单不可再更新."""
    case = _create_moderation_case(db_session, status="executed")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "retry", "decision": "delete", "skip_reason": "retry"},
        headers=AUTH,
    )
    assert resp.status_code == 400


def test_decide_invalid_decision_value_returns_400(
    client: TestClient, db_session: Session
) -> None:
    """decision 不在白名单（skip/hide/delete/resolve）返回 400。"""
    case = _create_moderation_case(db_session, status="pending")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "test", "decision": "ban_user"},
        headers=AUTH,
    )
    assert resp.status_code == 400


def test_pending_to_agent_proposed(client: TestClient, db_session: Session) -> None:
    """pending → agent_proposed：Agent 基于管理员反馈提出决策，工单仍未结案。"""
    case = _create_moderation_case(db_session, status="pending")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={
            "manager_feedback": "内容需要补充说明，建议延长回答",
            "decision": "hide",
            "skip_reason": None,
        },
        headers=AUTH,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "agent_proposed"
    assert data["manager_feedback"] == "内容需要补充说明，建议延长回答"
    assert data["agent_decision"] == "hide"
    assert data["decision_source"] == "agent_proposed"
    # 中间态未结案：处置与结案留痕字段必须为空（Agent 提议不等于执行）
    assert data["resolution"] is None
    assert data["resolved_by"] is None
    assert data["resolved_at"] is None


def test_agent_opening_manager_directed_lane_returns_403(
    client: TestClient, db_session: Session
) -> None:
    """C-06：Agent 不得自行开启 manager_directed 通道。"""
    case = _create_moderation_case(db_session, status="pending")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={
            "manager_feedback": "内容违规，立即隐藏",
            "decision": "delete",
            "decision_source": "manager_directed",
        },
        headers=AUTH,
    )
    assert resp.status_code == 403
    db_session.refresh(case)
    assert case.status == "pending"


def test_pending_to_manager_directed(client: TestClient, db_session: Session) -> None:
    """pending → manager_directed：仅管理员可开启直办通道。"""
    case = _create_moderation_case(db_session, status="pending")
    headers, _ = _admin_jwt_headers(client, db_session)
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={
            "manager_feedback": "内容违规，管理员直办",
            "decision": "delete",
            "skip_reason": None,
            "decision_source": "manager_directed",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "manager_directed"
    assert data["decision_source"] == "manager_directed"
    # 直办通道开启但尚未执行，仍无处置留痕
    assert data["resolution"] is None
    assert data["resolved_by"] is None


def test_agent_proposed_execution_by_agent_returns_403(
    client: TestClient, db_session: Session
) -> None:
    """C-06 核心红线：agent_proposed 上 Agent 凭服务 token 要求执行处置 → 403，工单不动。"""
    case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed"
    )
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "确认执行隐藏", "decision": "hide"},
        headers=AUTH,
    )
    assert resp.status_code == 403
    db_session.refresh(case)
    assert case.status == "agent_proposed"
    assert case.resolution is None


def test_agent_proposed_to_executed_by_admin(client: TestClient, db_session: Session) -> None:
    """agent_proposed → executed：管理员确认 hide 后真实隐藏问题（不再是只改工单的假处置）。"""
    ctx = _setup_course_with_question(client, db_session, "EX1")
    case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed",
        target_type="question", target_id=ctx["question_id"],
    )
    headers, admin_id = _admin_jwt_headers(client, db_session)
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "确认执行隐藏", "decision": "hide"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "executed"
    assert data["resolution"] == "hide"
    # 决策来源冻结，不被终态迁移覆盖
    assert data["decision_source"] == "agent_proposed"
    assert data["resolved_by"] == admin_id
    assert data["resolved_at"] is not None
    # 真实业务后果：问题被隐藏，公开详情 404（详情接口需登录，用提问者身份）
    db_session.expire_all()
    question = db_session.get(Question, ctx["question_id"])
    assert question.is_hidden is True
    assert question.deleted_at is None
    asker_headers = _auth(_login(client, "a_EX1"))
    public = client.get(f"/api/questions/{ctx['question_id']}", headers=asker_headers)
    assert public.status_code == 404


def test_agent_proposed_to_rejected_by_agent(client: TestClient, db_session: Session) -> None:
    """agent_proposed → rejected：Agent 依据管理员反馈以 skip 安全自终止。"""
    case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed"
    )
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "无需执行，忽略", "decision": "skip",
              "skip_reason": "管理员判定无风险"},
        headers=AUTH,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "rejected"
    assert data["resolution"] is None
    # 服务 token 自终止无操作人，但结案时间保留
    assert data["resolved_by"] is None
    assert data["resolved_at"] is not None


def test_agent_proposed_to_rejected_by_admin(client: TestClient, db_session: Session) -> None:
    """agent_proposed → rejected：管理员也可直接拒绝，拒绝动作留管理员痕。"""
    case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed"
    )
    headers, admin_id = _admin_jwt_headers(client, db_session, username="admin_rej")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "证据不足，拒绝处置", "decision": "skip"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "rejected"
    assert data["resolved_by"] == admin_id


def test_agent_closing_manager_directed_lane_returns_403(
    client: TestClient, db_session: Session
) -> None:
    """manager_directed 通道只能由管理员关闭：Agent 执行/拒绝均 403。"""
    case = _create_moderation_case(
        db_session, status="manager_directed", decision_source="manager_directed"
    )
    for decision in ("delete", "skip"):
        resp = client.patch(
            f"/internal/agent/moderation-cases/{case.id}/decision",
            json={"manager_feedback": "执行", "decision": decision},
            headers=AUTH,
        )
        assert resp.status_code == 403
    db_session.refresh(case)
    assert case.status == "manager_directed"


def test_manager_directed_to_executed_by_admin(
    client: TestClient, db_session: Session
) -> None:
    """manager_directed → executed：管理员直办 delete 真实软删问题。"""
    ctx = _setup_course_with_question(client, db_session, "MD1")
    case = _create_moderation_case(
        db_session, status="manager_directed", decision_source="manager_directed",
        target_type="question", target_id=ctx["question_id"],
    )
    headers, admin_id = _admin_jwt_headers(client, db_session, username="admin_dir")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "执行删除", "decision": "delete"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "executed"
    assert data["resolution"] == "delete"
    assert data["resolved_by"] == admin_id
    assert data["resolved_at"] is not None
    # 真实业务后果：deleted_at 落痕，公开详情 404，行仍保留供追溯
    db_session.expire_all()
    question = db_session.get(Question, ctx["question_id"])
    assert question.deleted_at is not None
    assert question.is_hidden is False
    asker_headers = _auth(_login(client, "a_MD1"))
    assert client.get(
        f"/api/questions/{ctx['question_id']}", headers=asker_headers
    ).status_code == 404


def test_invalid_decision_source_rejected_400(client: TestClient, db_session: Session) -> None:
    """无效的 decision_source 返回 400."""
    case = _create_moderation_case(db_session, status="pending")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={
            "manager_feedback": "test",
            "decision": "hide",
            "decision_source": "invalid_source",
        },
        headers=AUTH,
    )
    assert resp.status_code == 400


def test_unsupported_current_status(client: TestClient, db_session: Session) -> None:
    """不支持的当前状态（如脏数据）返回 400."""
    case = _create_moderation_case(db_session, status="unknown")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={
            "manager_feedback": "test",
            "decision": "hide",
        },
        headers=AUTH,
    )
    assert resp.status_code == 400


# ---------- skip 契约修正：pending 下 skip 直接终态（不再空转 agent_proposed） ----------


def test_pending_skip_by_agent_goes_directly_to_rejected(
    client: TestClient, db_session: Session
) -> None:
    """pending + skip（Agent 服务 token）一次请求直接 rejected 并结案。"""
    case = _create_moderation_case(db_session, status="pending")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "无风险，放弃处理", "decision": "skip",
              "skip_reason": "扫描误报"},
        headers=AUTH,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "rejected"
    assert data["resolution"] is None
    assert data["resolved_by"] is None
    assert data["resolved_at"] is not None
    db_session.refresh(case)
    assert case.status == "rejected"


def test_pending_skip_by_admin_goes_directly_to_rejected(
    client: TestClient, db_session: Session
) -> None:
    """pending + skip（管理员 JWT）同样直接 rejected，拒绝动作留管理员痕。"""
    case = _create_moderation_case(db_session, status="pending")
    headers, admin_id = _admin_jwt_headers(client, db_session, username="admin_pskip")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "证据不足，不予处置", "decision": "skip"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "rejected"
    assert data["resolved_by"] == admin_id
    assert data["resolved_at"] is not None


def test_pending_skip_with_manager_directed_source_still_rejected(
    client: TestClient, db_session: Session
) -> None:
    """skip 是放弃语义：即使带 manager_directed 来源也直接 rejected，不开启直办通道。"""
    case = _create_moderation_case(db_session, status="pending")
    headers, _ = _admin_jwt_headers(client, db_session, username="admin_pskip2")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "忽略", "decision": "skip",
              "decision_source": "manager_directed"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "rejected"
    db_session.refresh(case)
    assert case.decision_source is None


# ---------- 白名单词汇校正：resolve/warn/edit 退出，ban 仅对人 ----------


@pytest.mark.parametrize("bad_decision", ["resolve", "warn", "edit"])
def test_retired_decision_values_rejected_400(
    client: TestClient, db_session: Session, bad_decision: str
) -> None:
    """resolve（假处置）/warn（通知未交付）/edit（流程未建）一律 400，不留假成功入口。"""
    case = _create_moderation_case(db_session, status="agent_proposed")
    headers, _ = _admin_jwt_headers(client, db_session, username=f"admin_{bad_decision}")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "x", "decision": bad_decision},
        headers=headers,
    )
    assert resp.status_code == 400
    db_session.refresh(case)
    assert case.status == "agent_proposed"


def test_ban_decision_on_content_target_rejected_400(
    client: TestClient, db_session: Session
) -> None:
    """ban 只能作用于 user 类工单：对问题工单提议 ban 在 pending 阶段即 400。"""
    case = _create_moderation_case(
        db_session, status="pending", target_type="question", target_id=1
    )
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "建议封号", "decision": "ban"},
        headers=AUTH,
    )
    assert resp.status_code == 400
    db_session.refresh(case)
    assert case.status == "pending"


def test_hide_decision_on_user_target_rejected_400(
    client: TestClient, db_session: Session
) -> None:
    """hide/delete 只能作用于内容类工单：对 user 工单确认 hide 400，不执行任何动作。"""
    victim = _create_user(db_session, "ban_target_1")
    case = _create_moderation_case(
        db_session, status="agent_proposed", target_type="user", target_id=victim.id,
        decision_source="agent_proposed",
    )
    headers, _ = _admin_jwt_headers(client, db_session, username="admin_mismatch")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "隐藏用户", "decision": "hide"},
        headers=headers,
    )
    assert resp.status_code == 400
    db_session.refresh(case)
    assert case.status == "agent_proposed"
    db_session.refresh(victim)
    assert victim.status == "active"


# ---------- 处置前探针：目标缺失/已处置 → 409，工单停留中间态 ----------


def test_execute_on_missing_target_returns_409_and_keeps_case(
    client: TestClient, db_session: Session
) -> None:
    """目标不存在：禁止写 executed，返回 409，工单留在 agent_proposed。"""
    case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed",
        target_type="question", target_id=999999,
    )
    headers, _ = _admin_jwt_headers(client, db_session, username="admin_probe1")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "确认隐藏", "decision": "hide"},
        headers=headers,
    )
    assert resp.status_code == 409
    db_session.refresh(case)
    assert case.status == "agent_proposed"
    assert case.resolution is None
    assert case.resolved_at is None


def test_execute_hide_twice_second_returns_409(
    client: TestClient, db_session: Session
) -> None:
    """目标已隐藏：重复处置 409 幂等拦截，不产生第二条 executed。"""
    ctx = _setup_course_with_question(client, db_session, "PR1")
    case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed",
        target_type="question", target_id=ctx["question_id"],
    )
    headers, _ = _admin_jwt_headers(client, db_session, username="admin_probe2")
    first = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "隐藏", "decision": "hide"}, headers=headers,
    )
    assert first.status_code == 200
    # 第二张工单对同一已隐藏目标执行 hide
    case2 = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed",
        target_type="question", target_id=ctx["question_id"],
    )
    second = client.patch(
        f"/internal/agent/moderation-cases/{case2.id}/decision",
        json={"manager_feedback": "再次隐藏", "decision": "hide"}, headers=headers,
    )
    assert second.status_code == 409
    db_session.refresh(case2)
    assert case2.status == "agent_proposed"


def test_execute_delete_on_already_deleted_returns_409(
    client: TestClient, db_session: Session
) -> None:
    """目标已软删：delete 探针 409，工单不结案。"""
    ctx = _setup_course_with_question(client, db_session, "PR2")
    asker = _login(client, "a_PR2")
    deleted = client.delete(
        f"/api/questions/{ctx['question_id']}", headers=_auth(asker)
    )
    assert deleted.status_code == 200
    case = _create_moderation_case(
        db_session, status="manager_directed", decision_source="manager_directed",
        target_type="question", target_id=ctx["question_id"],
    )
    headers, _ = _admin_jwt_headers(client, db_session, username="admin_probe3")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "删除", "decision": "delete"}, headers=headers,
    )
    assert resp.status_code == 409
    db_session.refresh(case)
    assert case.status == "manager_directed"


# ---------- 完整处置链路：回答/评论隐藏、用户封禁、内部检索过滤 ----------


def _question_with_answer_and_comment(
    client: TestClient, db_session: Session, code: str
) -> dict:
    """构造真实问题 + 回答 + 问题评论，返回三者 id 与提问者 token。"""
    ctx = _setup_course_with_question(client, db_session, code)
    asker_token = _login(client, f"a_{code}")
    answer_id = client.post(
        f"/api/questions/{ctx['question_id']}/answers",
        json={"body": "这是一条待治理的回答"}, headers=_auth(asker_token),
    ).json()["data"]["id"]
    comment_id = client.post(
        f"/api/questions/{ctx['question_id']}/comments",
        json={"body": "这是一条待治理的评论"}, headers=_auth(asker_token),
    ).json()["data"]["id"]
    ctx.update(answer_id=answer_id, comment_id=comment_id, asker_token=asker_token)
    return ctx


def test_execute_hide_answer_removes_from_public_list(
    client: TestClient, db_session: Session
) -> None:
    """管理员确认 hide 回答：回答从公开回答列表消失，is_hidden 置位、行保留。"""
    ctx = _question_with_answer_and_comment(client, db_session, "HA1")
    case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed",
        target_type="answer", target_id=ctx["answer_id"],
    )
    headers, _ = _admin_jwt_headers(client, db_session, username="admin_ha")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "回答违规隐藏", "decision": "hide"}, headers=headers,
    )
    assert resp.status_code == 200
    db_session.expire_all()
    answer = db_session.get(Answer, ctx["answer_id"])
    assert answer.is_hidden is True
    assert answer.deleted_at is None
    items = client.get(
        f"/api/questions/{ctx['question_id']}/answers",
        headers=_auth(ctx["asker_token"]),
    ).json()["data"]["items"]
    assert all(item["id"] != ctx["answer_id"] for item in items)


def test_execute_delete_answer_soft_deletes(client: TestClient, db_session: Session) -> None:
    """管理员直办 delete 回答：deleted_at 落痕且从公开列表消失。"""
    ctx = _question_with_answer_and_comment(client, db_session, "DA1")
    case = _create_moderation_case(
        db_session, status="manager_directed", decision_source="manager_directed",
        target_type="answer", target_id=ctx["answer_id"],
    )
    headers, _ = _admin_jwt_headers(client, db_session, username="admin_da")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "回答违规删除", "decision": "delete"}, headers=headers,
    )
    assert resp.status_code == 200
    db_session.expire_all()
    assert db_session.get(Answer, ctx["answer_id"]).deleted_at is not None
    items = client.get(
        f"/api/questions/{ctx['question_id']}/answers",
        headers=_auth(ctx["asker_token"]),
    ).json()["data"]["items"]
    assert all(item["id"] != ctx["answer_id"] for item in items)


def test_execute_hide_comment_removes_from_tree(
    client: TestClient, db_session: Session
) -> None:
    """管理员确认 hide 评论：评论从公开评论树消失，is_hidden 置位、行保留。"""
    ctx = _question_with_answer_and_comment(client, db_session, "HC1")
    case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed",
        target_type="comment", target_id=ctx["comment_id"],
    )
    headers, _ = _admin_jwt_headers(client, db_session, username="admin_hc")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "评论违规隐藏", "decision": "hide"}, headers=headers,
    )
    assert resp.status_code == 200
    db_session.expire_all()
    comment = db_session.get(Comment, ctx["comment_id"])
    assert comment.is_hidden is True
    assert comment.deleted_at is None
    data = client.get(
        f"/api/questions/{ctx['question_id']}/comments",
        headers=_auth(ctx["asker_token"]),
    ).json()["data"]
    visible_ids = {item["id"] for item in data["items"]}
    assert ctx["comment_id"] not in visible_ids


def test_execute_ban_user_blocks_login_and_writes_audit(
    client: TestClient, db_session: Session
) -> None:
    """user 工单 ban 执行：当事人立即无法登录（403），封禁审计留管理员痕。"""
    victim = _create_user(db_session, "ban_victim_1")
    # 处置前可正常登录
    assert _login(client, "ban_victim_1")
    case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed",
        target_type="user", target_id=victim.id,
    )
    headers, admin_id = _admin_jwt_headers(client, db_session, username="admin_ban")
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "持续骚扰，永久封禁", "decision": "ban"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["resolution"] == "ban"
    db_session.refresh(victim)
    assert victim.status == "banned"
    assert victim.ban_reason
    # 被封用户登录被拒
    login_resp = client.post(
        "/api/auth/login", json={"account": "ban_victim_1", "password": "pass123456"}
    )
    assert login_resp.status_code == 403
    # 封禁审计：操作者为确认管理员，动作 ban
    audit = (
        db_session.query(UserStatusAudit)
        .filter(UserStatusAudit.target_user_id == victim.id)
        .one()
    )
    assert audit.action == "ban"
    assert audit.actor_id == admin_id
    assert audit.new_status == "banned"


def test_ban_already_banned_user_returns_409(
    client: TestClient, db_session: Session
) -> None:
    """探针：目标用户已封禁 → 409，工单停留中间态，不重复写审计。"""
    victim = _create_user(db_session, "ban_victim_2")
    headers, admin_id = _admin_jwt_headers(client, db_session, username="admin_ban2")
    first_case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed",
        target_type="user", target_id=victim.id,
    )
    first = client.patch(
        f"/internal/agent/moderation-cases/{first_case.id}/decision",
        json={"manager_feedback": "封禁", "decision": "ban"}, headers=headers,
    )
    assert first.status_code == 200
    second_case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed",
        target_type="user", target_id=victim.id,
    )
    second = client.patch(
        f"/internal/agent/moderation-cases/{second_case.id}/decision",
        json={"manager_feedback": "再次封禁", "decision": "ban"}, headers=headers,
    )
    assert second.status_code == 409
    db_session.refresh(second_case)
    assert second_case.status == "agent_proposed"
    audit_count = (
        db_session.query(UserStatusAudit)
        .filter(UserStatusAudit.target_user_id == victim.id)
        .count()
    )
    assert audit_count == 1


def test_internal_question_search_excludes_hidden(
    client: TestClient, db_session: Session
) -> None:
    """隐藏内容不得经 Agent 内部检索泄漏：处置后候选总数下降。"""
    ctx = _setup_course_with_question(client, db_session, "HS1")
    before = client.get(
        "/internal/agent/questions/search",
        params={"keyword": "TCP", "limit": 10}, headers=AUTH,
    ).json()["data"]["total"]
    assert before == 1
    case = _create_moderation_case(
        db_session, status="agent_proposed", decision_source="agent_proposed",
        target_type="question", target_id=ctx["question_id"],
    )
    headers, _ = _admin_jwt_headers(client, db_session, username="admin_hs")
    decision = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        json={"manager_feedback": "隐藏", "decision": "hide"}, headers=headers,
    )
    assert decision.status_code == 200
    after = client.get(
        "/internal/agent/questions/search",
        params={"keyword": "TCP", "limit": 10}, headers=AUTH,
    ).json()["data"]["total"]
    assert after == 0


# ---------- 决策轨迹：建单首行 + 每次推进追加，历史不丢 ----------


def test_decision_trace_records_create_and_appends_each_decision(
    client: TestClient, db_session: Session
) -> None:
    """decision_trace：建单记录动作白名单值；两轮推进各追加一行，旧行保留。"""
    created = client.post(
        "/internal/agent/approvals",
        json={
            "action_type": "hide_content",
            "risk_level": "high",
            "payload_snapshot": '{"question_id": 1}',
            "target_type": "question",
            "target_id": 1,
            "agent_run_id": "run-trace-001",
        },
        headers={**AUTH, "X-Trace-Id": "trace-trace-001"},
    )
    assert created.status_code == 200
    case_id = created.json()["data"]["id"]
    trace0 = created.json()["data"]["decision_trace"]
    assert "create" in trace0
    assert "hide_content" in trace0
    assert len(trace0.splitlines()) == 1

    # pending → agent_proposed 追加一行
    propose = client.patch(
        f"/internal/agent/moderation-cases/{case_id}/decision",
        json={"manager_feedback": "请先给出处置建议", "decision": "hide"},
        headers=AUTH,
    )
    assert propose.status_code == 200
    trace1 = propose.json()["data"]["decision_trace"]
    assert len(trace1.splitlines()) == 2
    assert "hide_content" in trace1  # 建单行保留

    # agent_proposed → rejected(skip) 再追加一行
    close = client.patch(
        f"/internal/agent/moderation-cases/{case_id}/decision",
        json={"manager_feedback": "误报，终止", "decision": "skip",
              "skip_reason": "管理员判定无风险"},
        headers=AUTH,
    )
    assert close.status_code == 200
    trace2 = close.json()["data"]["decision_trace"]
    lines = trace2.splitlines()
    assert len(lines) == 3
    assert lines[0] == trace0.splitlines()[0]
    assert "rejected" in lines[2]
    assert "管理员判定无风险" in lines[2]
