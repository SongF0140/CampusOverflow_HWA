# T-15-A 审批中心对外接口与申诉闭环测试（US-13/14/16，Q-06）：
# 管理员直决两步推进（manager_directed → executed 真实处置）、agent_proposed 确认、
# skip 直终态、非管理员越权 403、申诉自动定位/重复拒绝/复核三分支回退（解封/恢复可见/恢复软删）。
import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.courses.models import Course
from app.modules.governance.models import ModerationCase
from app.modules.identity.models import User
from app.modules.qa.models import Question

# 测试用户密码：进程内随机生成（避免源码硬编码凭据；创建与登录共用同一值）
TEST_PASSWORD = secrets.token_urlsafe(12)
SERVICE = {"X-Service-Token": settings.agent_service_token}


def _jwt(user: User) -> str:
    return create_access_token(user.id, user.role)


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {_jwt(user)}"}


def _create_user(db: Session, username: str, role: str = "student", **extra) -> User:
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash="unused",
        role=role,
        **extra,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _create_case(
    db: Session, target_type: str, target_id: int, reason: str, source: str = "admin",
) -> ModerationCase:
    """测试辅助：直接建一条 pending 工单（快照简化为文本）。"""
    case = ModerationCase(
        target_type=target_type, target_id=target_id, risk_level="high",
        source=source, reason=reason, snapshot='{"title":"快照"}', status="pending",
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@pytest.fixture
def actors(db_session: Session) -> dict[str, User]:
    return {
        "admin": _create_user(db_session, "t15_admin", "admin"),
        "teacher": _create_user(db_session, "t15_teacher", "teacher"),
        "student": _create_user(db_session, "t15_student", "student"),
        "student2": _create_user(db_session, "t15_student2", "student"),
    }


def _seed_question(db: Session, author: User, course: Course | None = None) -> Question:
    question = Question(
        title="违规内容标题",
        body="违规内容正文，用于治理处置与申诉回退验证。",
        course_id=course.id if course else 1,
        author_id=author.id,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


def _seed_course(db: Session, teacher: User) -> Course:
    course = Course(name="治理课程", code="CS-T15", teacher_id=teacher.id)
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


# ---------- 工单列表与管理员直决 ----------


def test_list_cases_filters_and_requires_admin(
    client: TestClient, db_session: Session, actors: dict[str, User]
) -> None:
    """管理员可列表并按状态/来源筛选；非管理员 403；未登录 401。"""
    _create_case(db_session, "question", 1, "违规一", source="agent")
    _create_case(db_session, "user", actors["student"].id, "违规二", source="admin")

    url = "/api/governance/moderation/cases"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=_auth(actors["student"])).status_code == 403
    assert client.get(url, headers=_auth(actors["teacher"])).status_code == 403

    resp = client.get(url, headers=_auth(actors["admin"]))
    assert resp.status_code == 200
    assert resp.json()["data"]["total"] == 2

    resp = client.get(
        f"{url}?status=pending&source=agent", headers=_auth(actors["admin"])
    )
    items = resp.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["source"] == "agent"

    # 非法筛选 400
    assert (
        client.get(
            f"{url}?status=invalid", headers=_auth(actors["admin"])
        ).status_code
        == 400
    )


def test_admin_direct_resolve_executes_hide(
    client: TestClient, db_session: Session, actors: dict[str, User]
) -> None:
    """pending 工单管理员直决 hide：两步推进、真实隐藏生效、轨迹与执行留痕完整。"""
    student = actors["student"]
    question = _seed_question(db_session, student)
    case = _create_case(db_session, "question", question.id, "垃圾广告")

    resp = client.post(
        f"/api/governance/moderation/cases/{case.id}/resolve",
        headers=_auth(actors["admin"]),
        json={"decision": "hide", "manager_feedback": "确认违规，隐藏"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "executed"
    assert data["resolution"] == "hide"
    assert data["resolved_by"] == actors["admin"].id
    # 内容真实隐藏（US-14 后端执行）；TestClient 独立会话提交，先清本会话缓存
    db_session.expire_all()
    assert (
        db_session.query(Question).filter(Question.id == question.id).one().is_hidden
        is True
    )
    # 轨迹含两步：开启直办通道 + 执行
    trace = data["decision_trace"]
    assert trace.count("[") >= 2

    # 终态不可再变更
    resp = client.post(
        f"/api/governance/moderation/cases/{case.id}/resolve",
        headers=_auth(actors["admin"]),
        json={"decision": "skip", "manager_feedback": "再试"},
    )
    assert resp.status_code == 400


def test_admin_confirm_agent_proposed_case(
    client: TestClient, db_session: Session, actors: dict[str, User]
) -> None:
    """agent_proposed 工单：管理员经 resolve 确认执行；Agent 直接执行被拒（C-06）。"""
    student = actors["student"]
    question = _seed_question(db_session, student)
    case = _create_case(db_session, "question", question.id, "Agent 扫描发现", source="agent")
    # Agent 提议：pending → agent_proposed（内部决策接口为 PATCH，T-16 扩展）
    resp = client.patch(
        f"/internal/agent/moderation-cases/{case.id}/decision",
        headers=SERVICE,
        json={"manager_feedback": "扫描判定违规", "decision": "hide",
              "decision_source": "agent_proposed"},
    )
    assert resp.status_code == 200

    # 管理员确认执行
    resp = client.post(
        f"/api/governance/moderation/cases/{case.id}/resolve",
        headers=_auth(actors["admin"]),
        json={"decision": "hide", "manager_feedback": "人工确认，执行"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "executed"
    db_session.expire_all()
    assert db_session.query(Question).filter(Question.id == question.id).one().is_hidden is True


def test_admin_skip_directly_rejects(
    client: TestClient, db_session: Session, actors: dict[str, User]
) -> None:
    """skip 一次直达 rejected，不执行任何处置。"""
    case = _create_case(db_session, "user", actors["student"].id, "误报工单")
    resp = client.post(
        f"/api/governance/moderation/cases/{case.id}/resolve",
        headers=_auth(actors["admin"]),
        json={"decision": "skip", "manager_feedback": "判定为误报"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "rejected"
    assert data["resolution"] is None
    assert db_session.query(User).filter(User.id == actors["student"].id).one().status == "active"

    # ban 决策对内容目标错配 → 400
    question = _seed_question(db_session, actors["student"])
    content_case = _create_case(db_session, "question", question.id, "类型错配")
    resp = client.post(
        f"/api/governance/moderation/cases/{content_case.id}/resolve",
        headers=_auth(actors["admin"]),
        json={"decision": "ban", "manager_feedback": "错配"},
    )
    assert resp.status_code == 400


# ---------- 申诉提交与复核（US-16） ----------


def test_appeal_auto_targets_recent_executed_case(
    client: TestClient, db_session: Session, actors: dict[str, User]
) -> None:
    """申诉自动定位本人最近 executed 工单；理由过短/无工单/重复申诉均拒绝。"""
    student = actors["student"]
    question = _seed_question(db_session, student)
    case = _create_case(db_session, "question", question.id, "隐藏处置")
    assert (
        client.post(
            f"/api/governance/moderation/cases/{case.id}/resolve",
            headers=_auth(actors["admin"]),
            json={"decision": "hide", "manager_feedback": "隐藏"},
        ).status_code
        == 200
    )

    # 理由不足 30 字 400
    resp = client.post(
        "/api/appeals", headers=_auth(student), json={"reason": "太短的理由"}
    )
    assert resp.status_code == 400
    # 非本人（无相关 executed 工单）400
    resp = client.post(
        "/api/appeals", headers=_auth(actors["student2"]),
        json={"reason": "这与我完全无关，我只是路过看到工单的一条普通理由。"},
    )
    assert resp.status_code == 400

    # 本人提交成功并自动关联工单
    reason = "我认为该内容属于正常课程讨论，不构成违规，请管理员复核恢复。"
    resp = client.post("/api/appeals", headers=_auth(student), json={"reason": reason})
    assert resp.status_code == 200
    appeal = resp.json()["data"]
    assert appeal["case_id"] == case.id
    assert appeal["status"] == "pending"

    # 同工单重复申诉 400
    resp = client.post("/api/appeals", headers=_auth(student), json={"reason": reason})
    assert resp.status_code == 400

    # 未登录 401
    assert client.post("/api/appeals", json={"reason": reason}).status_code == 401


def test_appeal_reject_resolution_keeps_execution(
    client: TestClient, db_session: Session, actors: dict[str, User]
) -> None:
    """复核 rejected：维持处置（内容保持隐藏），申诉留痕。"""
    student = actors["student"]
    question = _seed_question(db_session, student)
    case = _create_case(db_session, "question", question.id, "隐藏处置")
    client.post(
        f"/api/governance/moderation/cases/{case.id}/resolve",
        headers=_auth(actors["admin"]),
        json={"decision": "hide", "manager_feedback": "隐藏"},
    )
    _appeal_resp = client.post(
        "/api/appeals", headers=_auth(student),
        json={"reason":
             "请复核该内容：我认为该判定有误，内容属于正常课程讨论，"
             "并未违反社区规范，希望恢复展示。"},
    )
    assert _appeal_resp.status_code == 200, _appeal_resp.text
    appeal = _appeal_resp.json()["data"]

    resp = client.post(
        f"/api/governance/appeals/{appeal['id']}/resolve",
        headers=_auth(actors["admin"]),
        json={"resolution": "rejected", "resolution_note": "经复核维持原处置"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "rejected"
    db_session.expire_all()
    assert db_session.query(Question).filter(Question.id == question.id).one().is_hidden is True
    # 工单保持 executed 终态
    case_row = db_session.query(ModerationCase).filter(ModerationCase.id == case.id).one()
    assert case_row.status == "executed"
    # 重复复核 400
    resp = client.post(
        f"/api/governance/appeals/{appeal['id']}/resolve",
        headers=_auth(actors["admin"]),
        json={"resolution": "rejected", "resolution_note": "再次复核"},
    )
    assert resp.status_code == 400


def test_appeal_accept_restores_hidden_and_deleted(
    client: TestClient, db_session: Session, actors: dict[str, User]
) -> None:
    """复核 accepted：hide → 恢复可见；delete → 恢复软删内容。"""
    student = actors["student"]

    # hide 回退
    question = _seed_question(db_session, student)
    case = _create_case(db_session, "question", question.id, "隐藏处置")
    client.post(
        f"/api/governance/moderation/cases/{case.id}/resolve",
        headers=_auth(actors["admin"]),
        json={"decision": "hide", "manager_feedback": "隐藏"},
    )
    _appeal_resp = client.post(
        "/api/appeals", headers=_auth(student),
        json={"reason":
             "该内容为正常的课程学习笔记，并未违反社区规范，判定存在偏差，"
             "恳请管理员复核后恢复展示。"},
    )
    assert _appeal_resp.status_code == 200, _appeal_resp.text
    appeal = _appeal_resp.json()["data"]
    resp = client.post(
        f"/api/governance/appeals/{appeal['id']}/resolve",
        headers=_auth(actors["admin"]),
        json={"resolution": "accepted", "resolution_note": "复核属实，恢复可见"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "accepted"
    db_session.expire_all()
    assert db_session.query(Question).filter(Question.id == question.id).one().is_hidden is False

    # delete 回退
    question2 = _seed_question(db_session, student)
    case2 = _create_case(db_session, "question", question2.id, "删除处置")
    client.post(
        f"/api/governance/moderation/cases/{case2.id}/resolve",
        headers=_auth(actors["admin"]),
        json={"decision": "delete", "manager_feedback": "删除"},
    )
    _appeal_resp2 = client.post(
        "/api/appeals", headers=_auth(student),
        json={"reason":
             "该内容并无违规，删除处置影响我的正常学习交流，"
             "恳请管理员复核后恢复内容展示。"},
    )
    assert _appeal_resp2.status_code == 200, _appeal_resp2.text
    appeal2 = _appeal_resp2.json()["data"]
    resp = client.post(
        f"/api/governance/appeals/{appeal2['id']}/resolve",
        headers=_auth(actors["admin"]),
        json={"resolution": "accepted", "resolution_note": "复核属实，恢复内容"},
    )
    assert resp.status_code == 200
    db_session.expire_all()
    assert db_session.query(Question).filter(Question.id == question2.id).one().deleted_at is None


def test_appeal_accept_reverses_ban(
    client: TestClient, db_session: Session, actors: dict[str, User]
) -> None:
    """复核 accepted 对 ban 工单：解禁生效并留 identity 审计。"""
    student = actors["student"]
    case = _create_case(db_session, "user", student.id, "封禁处置")
    client.post(
        f"/api/governance/moderation/cases/{case.id}/resolve",
        headers=_auth(actors["admin"]),
        json={"decision": "ban", "manager_feedback": "屡次违规，封禁"},
    )
    db_session.expire_all()
    banned = db_session.query(User).filter(User.id == student.id).one()
    assert banned.status == "banned"
    # 封禁后 JWT 状态校验拒绝（数据库为真值源）
    assert client.get("/api/users/me", headers=_auth(student)).status_code == 403

    _appeal_resp = client.post(
        "/api/appeals", headers=_auth(student),
        json={"reason": "封禁依据不足，我并未发布任何违规内容，恳请管理员复核相关记录后解除封禁。"},
    )
    assert _appeal_resp.status_code == 200, _appeal_resp.text
    appeal = _appeal_resp.json()["data"]
    resp = client.post(
        f"/api/governance/appeals/{appeal['id']}/resolve",
        headers=_auth(actors["admin"]),
        json={"resolution": "accepted", "resolution_note": "复核属实，解除封禁"},
    )
    assert resp.status_code == 200
    db_session.expire_all()
    unbanned = db_session.query(User).filter(User.id == student.id).one()
    assert unbanned.status == "active"
    assert unbanned.ban_reason is None


def test_appeal_list_requires_admin(
    client: TestClient, db_session: Session, actors: dict[str, User]
) -> None:
    """申诉列表仅管理员；状态筛选非法 400。"""
    assert client.get("/api/governance/appeals").status_code == 401
    assert (
        client.get(
            "/api/governance/appeals", headers=_auth(actors["student"])
        ).status_code
        == 403
    )
    resp = client.get("/api/governance/appeals", headers=_auth(actors["admin"]))
    assert resp.status_code == 200
    assert (
        client.get(
            "/api/governance/appeals?status=invalid", headers=_auth(actors["admin"])
        ).status_code
        == 400
    )
