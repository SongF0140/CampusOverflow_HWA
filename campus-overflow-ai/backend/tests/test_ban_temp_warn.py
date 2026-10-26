# T-15-D 处置动作补全测试（US-14）：ban_temp 限时封禁（执行/期限落库/到期惰性解禁/
# 申诉回退清期限）、warn 警告（状态不变/审计留痕/当事人通知）、白名单目标匹配。
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.governance.models import ModerationCase
from app.modules.identity.models import User, UserStatusAudit
from app.modules.interaction.models import Notification

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


@pytest.fixture
def world(db_session: Session) -> dict:
    return {
        "admin": _create_user(db_session, "td_admin", "admin"),
        "student": _create_user(db_session, "td_stu", "student"),
        "student2": _create_user(db_session, "td_stu2", "student"),
    }


def _resolve(client: TestClient, admin: User, case_id: int, decision: str, **extra) -> dict:
    resp = client.post(
        f"/api/governance/moderation/cases/{case_id}/resolve",
        headers=_auth(admin),
        json={"decision": decision, "manager_feedback": "处置", **extra},
    )
    return resp


def test_ban_temp_executes_with_deadline(
    client: TestClient, db_session: Session, world: dict
) -> None:
    """ban_temp：状态 banned + banned_until 落库（默认 7 天）、审计留痕、当事人通知。"""
    student = world["student"]
    case = _create_case(db_session, "user", student.id, "违规行为")
    resp = _resolve(client, world["admin"], case.id, "ban_temp")
    assert resp.status_code == 200
    assert resp.json()["data"]["status"] == "executed"

    db_session.expire_all()
    banned = db_session.query(User).filter(User.id == student.id).one()
    assert banned.status == "banned"
    assert banned.banned_until is not None
    expected = datetime.now() + timedelta(days=7)
    assert abs((banned.banned_until - expected).total_seconds()) < 60
    assert "限时封禁 7 天" in banned.ban_reason
    # 审计留痕
    audit = db_session.query(UserStatusAudit).filter(
        UserStatusAudit.target_user_id == student.id, UserStatusAudit.action == "ban"
    ).one()
    assert audit.actor_id == world["admin"].id
    # 当事人收到限时封禁通知
    notice = db_session.query(Notification).filter(
        Notification.recipient_id == student.id
    ).one()
    assert "限时封禁" in notice.title


def test_ban_temp_custom_days_and_bounds(
    client: TestClient, db_session: Session, world: dict
) -> None:
    """ban_temp 自定义天数生效；超界（31 天）被 schema 拒绝（400）。"""
    student = world["student"]
    case = _create_case(db_session, "user", student.id, "违规")
    resp = _resolve(
        client, world["admin"], case.id, "ban_temp", duration_days=30
    )
    assert resp.status_code == 200
    db_session.expire_all()
    banned = db_session.query(User).filter(User.id == student.id).one()
    assert "限时封禁 30 天" in banned.ban_reason

    # 超界天数：schema le=30 → 400（全局处理器统一信封）
    case2 = _create_case(db_session, "user", world["student2"].id, "违规2")
    resp = _resolve(
        client, world["admin"], case2.id, "ban_temp", duration_days=31
    )
    assert resp.status_code == 400


def test_ban_temp_expiry_lazily_restores(
    client: TestClient, db_session: Session, world: dict
) -> None:
    """到期惰性解禁：探针判定过期即恢复 active 并留系统解禁审计。"""
    student = world["student"]
    case = _create_case(db_session, "user", student.id, "违规")
    _resolve(client, world["admin"], case.id, "ban_temp", duration_days=3)
    # 模拟时间流逝：把到期时间改到过去
    # （先清 db_session 身份映射——ban 由 TestClient 独立会话提交，旧快照会把 status 写回 active）
    db_session.expire_all()
    row = db_session.query(User).filter(User.id == student.id).one()
    row.banned_until = datetime.now() - timedelta(hours=1)
    db_session.commit()

    # 探针经 service 层直测（HTTP 探针端点仅内容类）；过期 → 惰性解禁 → ready
    from app.modules.identity import service as identity_service
    assert identity_service.moderation_probe_user(db_session, student.id) == "ready"
    # 探针只 flush（调用方事务提交）；测试内显式提交模拟真实调用方边界
    db_session.commit()
    db_session.expire_all()
    restored = db_session.query(User).filter(User.id == student.id).one()
    assert restored.status == "active"
    assert restored.banned_until is None
    expiry_audit = db_session.query(UserStatusAudit).filter(
        UserStatusAudit.target_user_id == student.id,
        UserStatusAudit.action == "unban",
        UserStatusAudit.actor_id == 0,
    ).one()
    assert expiry_audit is not None


def test_warn_keeps_status_and_notifies(
    client: TestClient, db_session: Session, world: dict
) -> None:
    """warn：账号状态不变、审计留痕、当事人收到警告通知；对内容目标 400。"""
    student = world["student"]
    case = _create_case(db_session, "user", student.id, "轻微违规")
    resp = _resolve(client, world["admin"], case.id, "warn")
    assert resp.status_code == 200
    db_session.expire_all()
    user = db_session.query(User).filter(User.id == student.id).one()
    assert user.status == "active"
    # warn 不产生状态审计（状态未变）；当事人感知靠通知
    assert db_session.query(UserStatusAudit).filter(
        UserStatusAudit.target_user_id == student.id,
        UserStatusAudit.action == "ban",
    ).count() == 0
    # warn 不写 status audit（状态未变），通知是当事人感知途径
    notice = db_session.query(Notification).filter(
        Notification.recipient_id == student.id
    ).one()
    assert "警告" in notice.title

    # warn 对内容目标：400（目标类型错配）
    case2 = _create_case(db_session, "question", 1, "内容警告错配")
    resp = _resolve(client, world["admin"], case2.id, "warn")
    assert resp.status_code == 400


def test_ban_temp_appeal_reversal_clears_deadline(
    client: TestClient, db_session: Session, world: dict
) -> None:
    """ban_temp 申诉撤销：解禁 + banned_until 清空（回退路径复用 unban）。"""
    student = world["student"]
    case = _create_case(db_session, "user", student.id, "限时封禁处置")
    _resolve(client, world["admin"], case.id, "ban_temp", duration_days=14)
    _resp = client.post(
        "/api/appeals", headers=_auth(student),
        json={"reason": "限时封禁依据不足，相关内容属于正常讨论并不违规，恳请复核后解除封禁。"},
    )
    assert _resp.status_code == 200, _resp.text
    appeal = _resp.json()["data"]
    resp = client.post(
        f"/api/governance/appeals/{appeal['id']}/resolve",
        headers=_auth(world["admin"]),
        json={"resolution": "accepted", "resolution_note": "复核属实，解除"},
    )
    assert resp.status_code == 200
    db_session.expire_all()
    restored = db_session.query(User).filter(User.id == student.id).one()
    assert restored.status == "active"
    assert restored.banned_until is None
