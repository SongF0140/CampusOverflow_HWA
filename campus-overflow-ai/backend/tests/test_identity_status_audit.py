"""封禁/解禁持久历史、JWT 操作者及事务失败回归。"""
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.modules.identity import domain, repository, service
from app.modules.identity.models import User, UserStatusAudit


def seed_users(db: Session) -> tuple[User, User]:
    actor = User(username="audit_admin", email="admin@test.com", password_hash="unused",
                 role="admin")
    target = User(username="audit_target", email="target@test.com", password_hash="unused")
    db.add_all([actor, target])
    db.commit()
    return actor, target


def test_history_keeps_previous_reasons_and_jwt_actor(
    client: TestClient, db_session: Session,
) -> None:
    actor, target = seed_users(db_session)
    headers = {"Authorization": f"Bearer {create_access_token(actor.id, actor.role)}"}
    before = datetime.now(UTC).replace(tzinfo=None, microsecond=0)
    for reason in ("第一次封禁", "修改原因"):
        response = client.post(
            f"/api/users/{target.id}/ban",
            json={"reason": reason, "actor_id": target.id}, headers=headers,
        )
        assert response.status_code == 200
    for _ in range(2):
        response = client.post(f"/api/users/{target.id}/unban", headers=headers)
        assert response.status_code == 200
        assert response.json()["data"]["ban_reason"] is None
    audits = db_session.query(UserStatusAudit).order_by(UserStatusAudit.id).all()
    assert len(audits) == 4
    assert [(a.action, a.previous_status, a.new_status) for a in audits] == [
        ("ban", "active", "banned"), ("ban", "banned", "banned"),
        ("unban", "banned", "active"), ("unban", "active", "active"),
    ]
    assert [(a.previous_reason, a.new_reason) for a in audits] == [
        (None, "第一次封禁"), ("第一次封禁", "修改原因"), ("修改原因", None), (None, None),
    ]
    after = datetime.now(UTC).replace(tzinfo=None)
    for audit in audits:
        assert audit.actor_id == actor.id
        assert audit.target_user_id == target.id
        assert before <= audit.created_at <= after
        assert audit.created_at.microsecond == 0
    db_session.refresh(target)
    assert target.status == "active" and target.ban_reason is None
    public = client.get(f"/api/users/{target.id}").json()["data"]
    assert "ban_reason" not in public and "audits" not in public


@pytest.mark.parametrize("role", ["student", "teacher", None])
@pytest.mark.parametrize("action", ["ban", "unban"])
def test_unauthorized_operation_writes_no_audit(
    client: TestClient, db_session: Session, role: str | None, action: str,
) -> None:
    actor, target = seed_users(db_session)
    actor.role = role or "student"
    db_session.commit()
    headers = {} if role is None else {
        "Authorization": f"Bearer {create_access_token(actor.id, actor.role)}",
    }
    response = client.post(
        f"/api/users/{target.id}/{action}", json={"reason": "越权"}, headers=headers,
    )
    assert response.status_code == (401 if role is None else 403)
    assert db_session.query(UserStatusAudit).count() == 0
    db_session.refresh(target)
    assert target.status == "active"


@pytest.mark.parametrize("action", ["ban", "unban"])
@pytest.mark.parametrize("failure", ["state", "audit", "commit"])
def test_status_and_audit_roll_back_together(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, action: str, failure: str,
) -> None:
    actor, target = seed_users(db_session)
    if action == "unban":
        service.ban_user(db_session, target.id, "必须保留的原因", actor.id)
    db_session.refresh(target)
    old_status, old_reason = target.status, target.ban_reason
    old_count = db_session.query(UserStatusAudit).count()

    def fail_after_write(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("注入持久化故障")

    def fail_commit():
        raise RuntimeError("注入提交故障")

    with monkeypatch.context() as patch:
        if failure == "commit":
            patch.setattr(db_session, "commit", fail_commit)
        else:
            name = "append_status_audit" if failure == "audit" else (
                "set_banned" if action == "ban" else "set_active"
            )
            original = getattr(repository, name)
            patch.setattr(repository, name, fail_after_write)
        with pytest.raises(RuntimeError):
            if action == "ban":
                service.ban_user(db_session, target.id, "不应保存", actor.id)
            else:
                service.unban_user(db_session, target.id, actor.id)
    db_session.refresh(target)
    assert (target.status, target.ban_reason) == (old_status, old_reason)
    assert db_session.query(UserStatusAudit).count() == old_count
    # 回滚后 Session 仍可用于完整成功用例。
    service.unban_user(db_session, target.id, actor.id)
    assert db_session.query(UserStatusAudit).count() == old_count + 1


def test_rejected_or_missing_target_does_not_create_history(db_session: Session) -> None:
    actor, target = seed_users(db_session)
    with pytest.raises(domain.AdminBanDeniedError):
        service.ban_user(db_session, actor.id, "不允许", actor.id)
    for operation in (service.ban_user, service.unban_user):
        with pytest.raises(domain.UserNotFoundError):
            if operation is service.ban_user:
                operation(db_session, target.id + 1000, "不存在", actor.id)
            else:
                operation(db_session, target.id + 1000, actor.id)
    assert db_session.query(UserStatusAudit).count() == 0


def test_locked_read_refreshes_stale_identity_map(db_session: Session) -> None:
    actor, target = seed_users(db_session)
    db_session.query(User).filter(User.id == target.id).update(
        {"status": "banned", "ban_reason": "数据库中的原因"}, synchronize_session=False,
    )
    db_session.commit()
    assert target.status == "active"
    service.unban_user(db_session, target.id, actor.id)
    audit = db_session.query(UserStatusAudit).one()
    assert audit.previous_status == "banned"
    assert audit.previous_reason == "数据库中的原因"
