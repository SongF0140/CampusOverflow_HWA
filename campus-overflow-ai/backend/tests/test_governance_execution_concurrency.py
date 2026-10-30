"""仅显式指定空的隔离 MySQL 库时运行；SQLite 不替代并发验收。"""

import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from test_approval_requests import setup as seed

from app.core.config import settings
from app.db.base import Base
from app.modules.governance import domain, service_approvals, service_execution_actions
from app.modules.governance import service_executions as approvals
from app.modules.governance.schemas import GovernanceRequestCreate
from app.modules.governance.schemas_executions import HumanApprovalDecision

LEASE = "isolated-mysql-execution-lease"


@pytest.fixture
def isolated_mysql(monkeypatch):
    raw = os.environ.get("CAMPUS_GL_TEST_MYSQL_URL")
    if not raw:
        pytest.skip("未配置 CAMPUS_GL_TEST_MYSQL_URL，真实 MySQL 并发验收待完成")
    url = make_url(raw)
    if url.drivername != "mysql+pymysql" or not (url.database or "").startswith("campus_gl_test_"):
        pytest.fail("仅允许 mysql+pymysql 且库名以 campus_gl_test_ 开头的专用空库")
    engine = create_engine(
        url,
        isolation_level="REPEATABLE READ",
        connect_args={"connect_timeout": 5, "read_timeout": 10, "write_timeout": 10},
    )
    try:
        if inspect(engine).get_table_names():
            pytest.fail("隔离测试库必须为空；拒绝修改任何已有表")
        Base.metadata.create_all(engine)
        try:
            monkeypatch.setattr(settings, "governance_executor_enabled", True)
            yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        finally:
            Base.metadata.drop_all(engine)
    finally:
        engine.dispose()


def pending_request(sessions):
    with sessions() as db:
        data = seed.__wrapped__(db)
        admin_id, reviewer_id, target_id = (
            data["admin"].id,
            data["other"].id,
            data["question"].id,
        )
        current = service_approvals.get_target_state(
            db,
            "question",
            target_id,
            include_version=True,
        )
        item = approvals.create_request(
            db,
            admin_id,
            GovernanceRequestCreate(
                request_id=uuid4(),
                target_type="question",
                target_id=target_id,
                action="hide",
                reason="并发执行验收",
                expected_version=current.state_version,
            ),
            "mysql-gl02-trace",
        )
        return item, admin_id, reviewer_id, target_id


def claim_for_test(sessions, execution_id):
    # 生产租约签发属于 GL-04；本测试只准备已获批任务的有效租约。
    with sessions() as db:
        db.execute(
            text(
                "UPDATE governance_execution_jobs SET state='claimed', lease_hash=:hash, "
                "lease_epoch=1, lease_expires_at=:at WHERE execution_id=:id"
            ),
            {
                "hash": hashlib.sha256(LEASE.encode()).hexdigest(),
                "id": execution_id,
                "at": (datetime.now(UTC) + timedelta(minutes=5)).replace(tzinfo=None),
            },
        )
        db.commit()


def test_mysql_concurrent_approve_and_execute_return_one_receipt(isolated_mysql):
    sessions = isolated_mysql
    item, requester_id, reviewer_id, target_id = pending_request(sessions)
    barrier = Barrier(2, timeout=10)

    def approve(actor_id):
        with sessions() as db:
            db.execute(text("SET SESSION innodb_lock_wait_timeout=5"))
            # 两个事务先建立旧快照，再竞争批准，验证任务关联也必须使用当前读取。
            db.execute(text("SELECT COUNT(*) FROM governance_execution_jobs")).scalar()
            barrier.wait()
            return approvals.decide_request(
                db,
                actor_id,
                item.request_id,
                HumanApprovalDecision(args_hash=item.args_hash, note="人工核对"),
                approve=True,
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(approve, [requester_id, reviewer_id], timeout=30))
    first, second = results
    assert first.execution_id and first.execution_id == second.execution_id
    assert first.approved_by == second.approved_by
    claim_for_test(sessions, first.execution_id)
    barrier = Barrier(2, timeout=10)

    def execute(_):
        with sessions() as db:
            db.execute(text("SET SESSION innodb_lock_wait_timeout=5"))
            db.execute(text("SELECT COUNT(*) FROM governance_execution_jobs")).scalar()
            barrier.wait()
            return service_execution_actions.execute(db, first.execution_id, LEASE, 1)

    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(execute, range(2), timeout=30))
    assert receipts[0] == receipts[1]
    with sessions() as db:
        assert db.execute(text("SELECT COUNT(*) FROM governance_execution_jobs")).scalar() == 1
        assert (
            db.execute(
                text("SELECT is_hidden FROM questions WHERE id=:id"), {"id": target_id}
            ).scalar()
            == 1
        )
        assert (
            db.execute(
                text(
                    "SELECT COUNT(*) FROM tool_call_logs "
                    "WHERE tool_name='executeApprovedGovernance'"
                )
            ).scalar()
            == 1
        )
        assert (
            db.execute(
                text("SELECT COUNT(*) FROM agent_runs WHERE task_type='governance_execute'")
            ).scalar()
            == 1
        )


def test_mysql_old_snapshot_cannot_hide_revoked_identity(isolated_mysql):
    sessions = isolated_mysql
    item, requester_id, reviewer_id, target_id = pending_request(sessions)
    with sessions() as db:
        approved = approvals.decide_request(
            db,
            reviewer_id,
            item.request_id,
            HumanApprovalDecision(args_hash=item.args_hash, note="人工核对"),
            approve=True,
        )
    claim_for_test(sessions, approved.execution_id)
    with sessions() as reader:
        reader.execute(text("SELECT role FROM users WHERE id=:id"), {"id": requester_id}).one()
        with sessions() as writer:
            writer.execute(
                text("UPDATE users SET role='student' WHERE id=:id"), {"id": requester_id}
            )
            writer.commit()
        with pytest.raises(domain.CaseActionForbiddenError):
            service_execution_actions.execute(reader, approved.execution_id, LEASE, 1)
    with sessions() as db:
        assert (
            db.execute(
                text("SELECT is_hidden FROM questions WHERE id=:id"), {"id": target_id}
            ).scalar()
            == 0
        )
