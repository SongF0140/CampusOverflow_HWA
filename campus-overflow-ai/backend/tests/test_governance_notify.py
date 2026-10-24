# T-15-C 治理通知测试（US-15 治理部分 / E-11）：
# 建单→管理员、处置→当事人、申诉提交→管理员、复核结果→申诉人；
# 通知与业务写入同事务（通知失败整体回滚）；当事人排除操作者（复用 notify 语义）。

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.governance.models import ModerationCase
from app.modules.identity.models import User
from app.modules.interaction.models import Notification
from app.modules.qa.models import Question

SERVICE_AUTH = {"X-Service-Token": settings.agent_service_token}


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}


def _create_user(db: Session, username: str, role: str = "student") -> User:
    user = User(
        username=username, email=f"{username}@example.com",
        password_hash="unused", role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _create_case(db: Session, target_type: str, target_id: int, reason: str) -> ModerationCase:
    case = ModerationCase(
        target_type=target_type, target_id=target_id, risk_level="high",
        source="agent", reason=reason, snapshot='{"title":"快照"}', status="pending",
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


def _notifications(db: Session, user_id: int) -> list[Notification]:
    # TestClient 在独立会话中提交；先清本会话身份映射再读，避免读到提交前缓存
    db.expire_all()
    return (
        db.query(Notification)
        .filter(Notification.recipient_id == user_id)
        .order_by(Notification.id.asc())
        .all()
    )


@pytest.fixture
def world(db_session: Session) -> dict:
    admin = _create_user(db_session, "ntc_admin", "admin")
    student = _create_user(db_session, "ntc_stu", "student")
    question = Question(
        title="待处置问题", body="待处置正文内容", course_id=1, author_id=student.id,
    )
    db_session.add(question)
    db_session.commit()
    db_session.refresh(question)
    return {"admin": admin, "student": student, "question": question}


def test_patrol_case_notifies_admins(
    client: TestClient, db_session: Session, world: dict
) -> None:
    """巡检建单 → 全部管理员收到 moderation 通知（含跳转链接），同事务落库。"""
    resp = client.post(
        "/internal/agent/patrol/cases", headers=SERVICE_AUTH,
        json={
            "target_type": "question", "target_id": world["question"].id,
            "risk_level": "high", "reason": "疑似违规内容，建议人工复核。",
            "snapshot": "question#1 body=…", "agent_run_id": "patrol-notify-1",
        },
    )
    assert resp.status_code == 200, resp.text
    admin_notices = _notifications(db_session, world["admin"].id)
    assert len(admin_notices) == 1
    assert admin_notices[0].type == "moderation"
    assert "审核工单" in admin_notices[0].title
    assert "case_id=" in admin_notices[0].link
    # 学生（当事人）不收建单通知——建单是管理员感知事件
    assert _notifications(db_session, world["student"].id) == []


def test_resolve_notifies_owner(
    client: TestClient, db_session: Session, world: dict
) -> None:
    """管理员处置 hide → 当事人收到结果通知；skip（无处置）不通知当事人。"""
    case = _create_case(db_session, "question", world["question"].id, "隐藏处置")
    resp = client.post(
        f"/api/governance/moderation/cases/{case.id}/resolve",
        headers=_auth(world["admin"]),
        json={"decision": "hide", "manager_feedback": "确认违规"},
    )
    assert resp.status_code == 200
    notices = _notifications(db_session, world["student"].id)
    assert len(notices) == 1
    assert "内容已被隐藏" in notices[0].title
    assert f"case_id={case.id}" in notices[0].link
    # 管理员自己不是当事人，不收通知
    assert _notifications(db_session, world["admin"].id) == []

    # skip 工单（user 目标、另一学生）：当事人收到"经复核无需处置"的澄清通知
    student2 = _create_user(db_session, "ntc_stu2", "student")
    case2 = _create_case(db_session, "user", student2.id, "误报")
    resp = client.post(
        f"/api/governance/moderation/cases/{case2.id}/resolve",
        headers=_auth(world["admin"]),
        json={"decision": "skip", "manager_feedback": "误报，不处置"},
    )
    assert resp.status_code == 200
    notices2 = _notifications(db_session, student2.id)
    assert len(notices2) == 1
    assert "经复核无需处置" in notices2[0].title


def test_appeal_flow_notifies_both_sides(
    client: TestClient, db_session: Session, world: dict
) -> None:
    """申诉提交→管理员；复核结果→申诉人；解禁回退的通知与回退同事务。"""
    student = world["student"]
    case = _create_case(db_session, "user", student.id, "封禁处置")
    client.post(
        f"/api/governance/moderation/cases/{case.id}/resolve",
        headers=_auth(world["admin"]),
        json={"decision": "ban", "manager_feedback": "封禁"},
    )
    # 封禁通知（当事人）已发一条
    assert len(_notifications(db_session, student.id)) == 1

    # 申诉提交 → 管理员收到
    appeal_resp = client.post(
        "/api/appeals", headers=_auth(student),
        json={"reason":
             "封禁依据不足，我并未发布任何违规内容，相关判定与事实不符，"
             "恳请管理员复核后解除封禁。"},
    )
    assert appeal_resp.status_code == 200, appeal_resp.text
    appeal = appeal_resp.json()["data"]
    admin_notices = _notifications(db_session, world["admin"].id)
    assert any("申诉" in n.title for n in admin_notices)

    # 复核 accepted → 申诉人收到解禁通知
    resp = client.post(
        f"/api/governance/appeals/{appeal['id']}/resolve",
        headers=_auth(world["admin"]),
        json={"resolution": "accepted", "resolution_note": "复核属实，解除封禁"},
    )
    assert resp.status_code == 200
    student_notices = _notifications(db_session, student.id)
    assert any("处置已撤销" in n.title for n in student_notices)
    # 当事人状态为 active（通知与回退同事务生效）
    assert db_session.query(User).filter(User.id == student.id).one().status == "active"

    # rejected 分支：另一学生维持处置的通知
    student2 = _create_user(db_session, "ntc_stu3", "student")
    case2 = _create_case(db_session, "user", student2.id, "封禁2")
    client.post(
        f"/api/governance/moderation/cases/{case2.id}/resolve",
        headers=_auth(world["admin"]),
        json={"decision": "ban", "manager_feedback": "封禁2"},
    )
    appeal2 = client.post(
        "/api/appeals", headers=_auth(student2),
        json={"reason":
             "我认为封禁判定有误，所发内容属于正常讨论并无违规，"
             "恳请管理员复核后纠正或维持。"},
    ).json()["data"]
    client.post(
        f"/api/governance/appeals/{appeal2['id']}/resolve",
        headers=_auth(world["admin"]),
        json={"resolution": "rejected", "resolution_note": "维持原处置"},
    )
    notices2 = _notifications(db_session, student2.id)
    assert any("维持原处置" in n.title for n in notices2)
