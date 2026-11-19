"""真实 MySQL 并发验证：活动槽位唯一索引 + worker 原子认领/租约。"""

import os
import queue
import threading
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.base import Base
from app.modules.courses import models as _courses_models  # noqa: F401
from app.modules.governance import models as _governance_models  # noqa: F401
from app.modules.governance import repository
from app.modules.governance.models import PatrolScanJob
from app.modules.identity import models as _identity_models  # noqa: F401
from app.modules.interaction import models as _interaction_models  # noqa: F401
from app.modules.qa import models as _qa_models  # noqa: F401

TEST_MYSQL_URL = os.getenv("TEST_MYSQL_URL")

pytestmark = pytest.mark.skipif(
    not TEST_MYSQL_URL,
    reason="需要 TEST_MYSQL_URL；先用 deploy/test-sandbox 启动 MySQL",
)


def _insert_active(engine, barrier: threading.Barrier, results: queue.Queue, trace: str) -> None:
    with Session(engine) as session:
        barrier.wait(timeout=10)
        session.add(
            PatrolScanJob(
                status="queued",
                active_slot="patrol_scan",
                target_types=["question"],
                trace_id=trace,
            )
        )
        try:
            session.commit()
            results.put("ok")
        except IntegrityError:
            session.rollback()
            results.put("conflict")


def test_only_one_active_scan_survives_concurrent_insert() -> None:
    engine = create_engine(TEST_MYSQL_URL, pool_pre_ping=True)
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            session.query(PatrolScanJob).delete()
            session.commit()

        barrier = threading.Barrier(2)
        results: queue.Queue[str] = queue.Queue()
        threads = [
            threading.Thread(
                target=_insert_active, args=(engine, barrier, results, f"mysql-race-{index}")
            )
            for index in range(2)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)

        assert sorted([results.get_nowait(), results.get_nowait()]) == ["conflict", "ok"]
        with Session(engine) as session:
            active = session.query(PatrolScanJob).filter(
                PatrolScanJob.active_slot.is_not(None)
            ).count()
            assert active == 1
    finally:
        with Session(engine) as session:
            session.query(PatrolScanJob).delete()
            session.commit()
        engine.dispose()


def _claim(
    engine, job_id: int, worker_id: str, barrier: threading.Barrier,
    results: queue.Queue, trace: str,
) -> None:
    with Session(engine) as session:
        barrier.wait(timeout=10)
        token = f"{worker_id}-token-".ljust(32, "0")
        expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(seconds=60)
        ok = repository.try_claim_patrol_scan_job(
            session, job_id, worker_id, token, expires_at
        )
        session.commit()
        results.put(("ok" if ok else "conflict", trace))


def test_concurrent_claim_allows_single_worker() -> None:
    """两个独立执行者同时认领同一任务：条件更新只有一个 rowcount=1。"""
    engine = create_engine(TEST_MYSQL_URL, pool_pre_ping=True)
    Base.metadata.create_all(engine)
    job_id = 0
    try:
        with Session(engine) as session:
            session.query(PatrolScanJob).delete()
            session.commit()
            job = repository.create_patrol_scan_job(
                session, ["question"], None, "mysql-claim"
            )
            session.commit()
            job_id = job.id

        barrier = threading.Barrier(2)
        results: queue.Queue[tuple[str, str]] = queue.Queue()
        threads = [
            threading.Thread(
                target=_claim,
                args=(engine, job_id, f"worker-{index}", barrier, results, f"trace-{index}"),
            )
            for index in range(2)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)

        outcome = {results.get_nowait()[0], results.get_nowait()[0]}
        assert outcome == {"ok", "conflict"}
        with Session(engine) as session:
            row = session.get(PatrolScanJob, job_id)
            assert row.status == "running"
            assert row.worker_id is not None
            assert row.worker_token is not None
            assert row.lease_expires_at is not None
    finally:
        with Session(engine) as session:
            session.query(PatrolScanJob).delete()
            session.commit()
        engine.dispose()


def test_expired_lease_recovery_on_mysql() -> None:
    """租约过期后新 worker 可接管，旧 token 续租失败。"""
    engine = create_engine(TEST_MYSQL_URL, pool_pre_ping=True)
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            session.query(PatrolScanJob).delete()
            session.commit()
            job = repository.create_patrol_scan_job(
                session, ["question"], None, "mysql-lease"
            )
            session.commit()
            job_id = job.id

            now = datetime.now(UTC).replace(tzinfo=None)
            old_token = "a" * 32
            assert repository.try_claim_patrol_scan_job(
                session, job_id, "worker-a", old_token, now - timedelta(seconds=1)
            )
            session.commit()
            assert not repository.renew_patrol_scan_lease(
                session, job_id, old_token, now + timedelta(seconds=60)
            )
            session.rollback()

            new_token = "b" * 32
            assert repository.try_claim_patrol_scan_job(
                session, job_id, "worker-b", new_token, now + timedelta(seconds=60)
            )
            session.commit()
            row = session.get(PatrolScanJob, job_id)
            session.refresh(row)
            assert (row.worker_id, row.worker_token) == ("worker-b", new_token)
    finally:
        with Session(engine) as session:
            session.query(PatrolScanJob).delete()
            session.commit()
        engine.dispose()
