"""真实 MySQL 并发验证：active_slot 唯一索引保证同刻仅一个活动扫描任务。"""

import os
import queue
import threading

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.base import Base
from app.modules.courses import models as _courses_models  # noqa: F401
from app.modules.governance import models as _governance_models  # noqa: F401
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
