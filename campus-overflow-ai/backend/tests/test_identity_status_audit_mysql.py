"""显式开启的本地 MySQL 审计验收；外层事务回滚所有测试数据。"""
import os
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.identity import repository, service
from app.modules.identity.models import User, UserStatusAudit


@pytest.fixture
def local_mysql_audit_case():
    if os.environ.get("RUN_LOCAL_STATUS_AUDIT_MYSQL") != "1":
        pytest.skip("未显式开启本地测试库审计验收")
    url = sa.engine.make_url(settings.database_url)
    if url.get_backend_name() != "mysql" or url.host not in ("localhost", "127.0.0.1", "::1"):
        pytest.fail("本专项只允许使用用户确认的本地 MySQL 测试配置", pytrace=False)
    engine = sa.create_engine(url)
    user_ids = []
    try:
        with engine.connect() as connection:
            outer = connection.begin()
            db = Session(bind=connection, autoflush=False, expire_on_commit=False,
                         join_transaction_mode="create_savepoint")
            token = "audit_" + uuid4().hex
            actor = User(username=f"{token}_a", email=f"{token}_a@test.com",
                         password_hash="unused", role="admin")
            target = User(username=f"{token}_t", email=f"{token}_t@test.com",
                          password_hash="unused")
            try:
                db.add_all([actor, target])
                db.commit()
                user_ids = [actor.id, target.id]
                yield db, actor.id, target.id
            finally:
                db.close()
                outer.rollback()
        with engine.connect() as connection:
            assert connection.execute(
                sa.select(User.id).where(User.id.in_(user_ids)),
            ).first() is None
            assert connection.execute(
                sa.select(UserStatusAudit.id).where(UserStatusAudit.target_user_id.in_(user_ids)),
            ).first() is None
    finally:
        engine.dispose()


def test_local_mysql_audit_schema(local_mysql_audit_case) -> None:
    db, _, _ = local_mysql_audit_case
    inspector = sa.inspect(db.connection())
    assert inspector.get_table_options("user_status_audits")["mysql_engine"] == "InnoDB"
    columns = {column["name"]: column for column in inspector.get_columns("user_status_audits")}
    assert len(columns) == 9
    assert columns["created_at"]["nullable"] is False
    assert columns["previous_reason"]["type"].length == 200
    indexes = inspector.get_indexes("user_status_audits")
    assert {tuple(index["column_names"]) for index in indexes} >= {
        ("actor_id", "created_at", "id"), ("target_user_id", "created_at", "id"),
    }
    keys = inspector.get_foreign_keys("user_status_audits")
    assert {tuple(key["constrained_columns"]) for key in keys} == {
        ("actor_id",), ("target_user_id",),
    }
    revision = db.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()
    assert revision == "9f27b104c6de"


def test_local_mysql_history_keeps_reason_and_utc(local_mysql_audit_case) -> None:
    db, actor_id, target_id = local_mysql_audit_case
    before = datetime.now(UTC).replace(tzinfo=None, microsecond=0)
    service.ban_user(db, target_id, "本地审计测试", actor_id)
    service.unban_user(db, target_id, actor_id)
    audits = db.query(UserStatusAudit).filter_by(target_user_id=target_id).order_by(
        UserStatusAudit.id,
    ).all()
    assert len(audits) == 2
    assert [(a.previous_status, a.new_status) for a in audits] == [
        ("active", "banned"), ("banned", "active"),
    ]
    assert audits[1].previous_reason == "本地审计测试" and audits[1].new_reason is None
    after = datetime.now(UTC).replace(tzinfo=None)
    assert all(a.actor_id == actor_id and before <= a.created_at <= after for a in audits)


def test_local_mysql_foreign_key_failure_rolls_back_status(local_mysql_audit_case) -> None:
    db, _, target_id = local_mysql_audit_case
    with pytest.raises(sa.exc.IntegrityError):
        service.ban_user(db, target_id, "不应保存", 2147483647)
    target = repository.get_by_id(db, target_id)
    assert target.status == "active" and target.ban_reason is None
    assert db.query(UserStatusAudit).filter_by(target_user_id=target_id).count() == 0


@pytest.mark.parametrize("action", ["ban", "unban"])
def test_local_mysql_repeated_success_is_audited(local_mysql_audit_case, action: str) -> None:
    db, actor_id, target_id = local_mysql_audit_case
    for _ in range(2):
        if action == "ban":
            service.ban_user(db, target_id, "相同原因", actor_id)
        else:
            service.unban_user(db, target_id, actor_id)
    audits = db.query(UserStatusAudit).filter_by(target_user_id=target_id).order_by(
        UserStatusAudit.id,
    ).all()
    assert len(audits) == 2
    assert audits[1].previous_status == audits[1].new_status
    assert audits[1].previous_reason == audits[1].new_reason


@pytest.mark.parametrize("action", ["ban", "unban"])
@pytest.mark.parametrize("failure", ["state", "audit", "commit"])
def test_local_mysql_failure_is_atomic(
    local_mysql_audit_case, monkeypatch: pytest.MonkeyPatch, action: str, failure: str,
) -> None:
    db, actor_id, target_id = local_mysql_audit_case
    if action == "unban":
        service.ban_user(db, target_id, "原有原因", actor_id)
    old = repository.get_by_id(db, target_id)
    old_count = db.query(UserStatusAudit).filter_by(target_user_id=target_id).count()

    def fail_after_flush(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("注入本地审计故障")

    def fail_commit():
        raise RuntimeError("注入本地提交故障")

    with monkeypatch.context() as patch:
        if failure == "commit":
            patch.setattr(db, "commit", fail_commit)
        else:
            name = "append_status_audit" if failure == "audit" else (
                "set_banned" if action == "ban" else "set_active"
            )
            original = getattr(repository, name)
            patch.setattr(repository, name, fail_after_flush)
        with pytest.raises(RuntimeError):
            if action == "ban":
                service.ban_user(db, target_id, "不能保存", actor_id)
            else:
                service.unban_user(db, target_id, actor_id)
    current = repository.get_by_id(db, target_id)
    assert (current.status, current.ban_reason) == (old.status, old.ban_reason)
    assert db.query(UserStatusAudit).filter_by(target_user_id=target_id).count() == old_count
