# P2 管理员全量扫描任务：服务间鉴权、创建/查询/取消、分批游标、worker 认领与租约。
import secrets
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.modules.courses.models import Course
from app.modules.governance import repository
from app.modules.governance.models import PatrolScanJob
from app.modules.identity.models import User
from app.modules.qa.models import Answer, Comment, Question

TOKEN = settings.agent_service_token
AUTH = {"X-Service-Token": TOKEN}
PASSWORD = secrets.token_urlsafe(12)
BASE = "/internal/agent/patrol/scans"


def _user(db: Session, username: str, role: str = "student") -> User:
    user = User(
        username=username, email=f"{username}@example.com",
        password_hash=hash_password(PASSWORD), role=role,
    )
    db.add(user)
    db.flush()
    return user


def _seed(db: Session) -> dict:
    teacher = _user(db, "scan_t", "teacher")
    student = _user(db, "scan_s")
    course = Course(name="操作系统", code="SCAN-1", teacher_id=teacher.id)
    db.add(course)
    db.flush()
    question = Question(
        title="进程与线程区别", body="请解释进程与线程。",
        course_id=course.id, author_id=student.id,
    )
    db.add(question)
    db.flush()
    answer = Answer(question_id=question.id, author_id=teacher.id, body="线程共享地址空间。")
    db.add(answer)
    db.flush()
    comment = Comment(question_id=question.id, author_id=student.id, body="补充说明。")
    hidden = Question(
        title="已隐藏问题", body="不应进入扫描。",
        course_id=course.id, author_id=student.id, is_hidden=True,
    )
    db.add_all([comment, hidden])
    db.commit()
    return {
        "question_id": question.id, "answer_id": answer.id,
        "comment_id": comment.id, "hidden_id": hidden.id,
    }


def _create(client: TestClient, body: dict | None = None) -> dict:
    resp = client.post(BASE, json=body or {}, headers={**AUTH, "X-Trace-Id": "trace-scan"})
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def _claim(
    client: TestClient, job_id: int, worker_id: str = "agent-a", lease_seconds: int = 60
) -> str:
    resp = client.post(
        f"{BASE}/{job_id}/claim",
        json={"worker_id": worker_id, "lease_seconds": lease_seconds},
        headers=AUTH,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["worker_token"]


def _expire_lease(db: Session, job_id: int) -> None:
    row = db.get(PatrolScanJob, job_id)
    row.lease_expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
    db.commit()


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", BASE),
        ("get", f"{BASE}/1"),
        ("post", f"{BASE}/1/cancel"),
        ("post", f"{BASE}/1/claim"),
        ("post", f"{BASE}/1/heartbeat"),
        ("patch", f"{BASE}/1/progress"),
        ("get", f"{BASE}/1/page"),
    ],
)
def test_scan_endpoints_require_service_token(
    client: TestClient, db_session: Session, method: str, path: str
) -> None:
    resp = (
        getattr(client, method)(path, json={})
        if method in ("post", "patch")
        else getattr(client, method)(path)
    )
    assert resp.status_code == 401


def test_create_defaults_all_targets_and_trace(
    client: TestClient, db_session: Session
) -> None:
    job = _create(client, {"created_by": 7})
    assert job["status"] == "queued"
    assert job["target_types"] == ["question", "answer", "comment"]
    assert job["created_by"] == 7
    assert job["trace_id"] == "trace-scan"
    assert job["scanned"] == 0
    assert job["cursor_type"] is None


def test_active_scan_conflict_409(client: TestClient, db_session: Session) -> None:
    _create(client)
    resp = client.post(BASE, json={}, headers=AUTH)
    assert resp.status_code == 409
    assert resp.json()["code"] == 409


def test_database_unique_slot_rejects_second_active_row(db_session: Session) -> None:
    repository.create_patrol_scan_job(db_session, ["question"], None, "trace-a")
    db_session.commit()
    with pytest.raises(IntegrityError):
        repository.create_patrol_scan_job(db_session, ["answer"], None, "trace-b")
        db_session.commit()
    db_session.rollback()


def test_create_conflict_is_atomic_when_precheck_races(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """模拟两个请求同时通过预检查：唯一索引仍需只允许一个提交成功。"""
    first = _create(client)
    monkeypatch.setattr(repository, "get_active_patrol_scan_job", lambda _db: None)

    resp = client.post(BASE, json={}, headers=AUTH)

    assert resp.status_code == 409
    assert resp.json()["code"] == 409
    active = (
        db_session.query(PatrolScanJob)
        .filter(PatrolScanJob.status.in_(("queued", "running")))
        .all()
    )
    assert [row.id for row in active] == [first["id"]]
    assert active[0].active_slot == "patrol_scan"


def test_active_slot_released_on_cancel_and_terminal(
    client: TestClient, db_session: Session
) -> None:
    cancelled_job = _create(client)
    _claim(client, cancelled_job["id"])
    cancelled = client.post(f"{BASE}/{cancelled_job['id']}/cancel", headers=AUTH)
    assert cancelled.status_code == 200
    db_session.expire_all()
    row = db_session.get(PatrolScanJob, cancelled_job["id"])
    assert row.active_slot is None
    assert (row.worker_id, row.worker_token, row.lease_expires_at) == (None, None, None)

    progress_job = _create(client)
    token = _claim(client, progress_job["id"])
    progress = client.patch(
        f"{BASE}/{progress_job['id']}/progress",
        json={"worker_token": token, "scanned_delta": 1, "status": "succeeded"},
        headers=AUTH,
    )
    assert progress.status_code == 200
    db_session.expire_all()
    assert db_session.get(PatrolScanJob, progress_job["id"]).active_slot is None

    third = _create(client)
    assert third["status"] == "queued"


def test_claim_is_exclusive_and_reports_lease(
    client: TestClient, db_session: Session
) -> None:
    job = _create(client)
    token = _claim(client, job["id"], worker_id="agent-a")

    again = client.post(
        f"{BASE}/{job['id']}/claim",
        json={"worker_id": "agent-b", "lease_seconds": 60},
        headers=AUTH,
    )
    assert again.status_code == 409
    assert again.json()["code"] == 409

    db_session.expire_all()
    row = db_session.get(PatrolScanJob, job["id"])
    assert row.status == "running"
    assert row.started_at is not None
    assert row.worker_id == "agent-a"
    assert row.worker_token == token
    assert row.lease_expires_at is not None


def test_expired_lease_allows_takeover_and_rejects_old_worker(
    client: TestClient, db_session: Session
) -> None:
    job = _create(client)
    old_token = _claim(client, job["id"], worker_id="agent-a", lease_seconds=10)
    _expire_lease(db_session, job["id"])

    new_token = _claim(client, job["id"], worker_id="agent-b")
    assert new_token != old_token

    stale = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={"worker_token": old_token, "scanned_delta": 1},
        headers=AUTH,
    )
    assert stale.status_code == 409

    fresh = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={"worker_token": new_token, "scanned_delta": 1},
        headers=AUTH,
    )
    assert fresh.status_code == 200
    assert fresh.json()["data"]["scanned"] == 1
    assert fresh.json()["data"]["status"] == "running"


def test_expired_lease_blocks_old_worker_without_takeover(
    client: TestClient, db_session: Session
) -> None:
    job = _create(client)
    token = _claim(client, job["id"], lease_seconds=10)
    _expire_lease(db_session, job["id"])

    stale = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={"worker_token": token, "scanned_delta": 1},
        headers=AUTH,
    )
    assert stale.status_code == 409
    page = client.get(
        f"{BASE}/{job['id']}/page", params={"worker_token": token}, headers=AUTH
    )
    assert page.status_code == 409


def test_heartbeat_extends_only_for_current_token(
    client: TestClient, db_session: Session
) -> None:
    job = _create(client)
    token = _claim(client, job["id"], worker_id="agent-a", lease_seconds=10)
    db_session.expire_all()
    before = db_session.get(PatrolScanJob, job["id"]).lease_expires_at

    renewed = client.post(
        f"{BASE}/{job['id']}/heartbeat",
        json={"worker_token": token, "lease_seconds": 60},
        headers=AUTH,
    )
    assert renewed.status_code == 200
    db_session.expire_all()
    after = db_session.get(PatrolScanJob, job["id"]).lease_expires_at
    assert after > before

    wrong = client.post(
        f"{BASE}/{job['id']}/heartbeat",
        json={"worker_token": "x" * 32, "lease_seconds": 60},
        headers=AUTH,
    )
    assert wrong.status_code == 409


def test_cancel_releases_lease_and_blocks_old_worker(
    client: TestClient, db_session: Session
) -> None:
    job = _create(client)
    token = _claim(client, job["id"])
    cancelled = client.post(f"{BASE}/{job['id']}/cancel", headers=AUTH)
    assert cancelled.status_code == 200

    stale = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={"worker_token": token, "scanned_delta": 1},
        headers=AUTH,
    )
    assert stale.status_code == 200
    assert stale.json()["data"]["status"] == "cancelled"
    assert stale.json()["data"]["scanned"] == 0

    heartbeat = client.post(
        f"{BASE}/{job['id']}/heartbeat",
        json={"worker_token": token, "lease_seconds": 60},
        headers=AUTH,
    )
    assert heartbeat.status_code == 409


def test_page_cursor_and_target_filter(client: TestClient, db_session: Session) -> None:
    ids = _seed(db_session)
    job = _create(client, {"target_types": ["question"]})
    token = _claim(client, job["id"])

    first = client.get(
        f"{BASE}/{job['id']}/page",
        params={"worker_token": token, "limit": 1},
        headers=AUTH,
    )
    assert first.status_code == 200
    data = first.json()["data"]
    assert [item["target_type"] for item in data["items"]] == ["question"]
    assert data["items"][0]["target_id"] == ids["question_id"]
    assert data["has_more"] is False

    progress = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={
            "worker_token": token,
            "cursor_type": "question", "cursor_id": ids["question_id"],
            "scanned_delta": 1, "status": "succeeded",
        },
        headers=AUTH,
    )
    assert progress.status_code == 200
    assert progress.json()["data"]["scanned"] == 1
    assert progress.json()["data"]["status"] == "succeeded"

    empty = client.get(
        f"{BASE}/{job['id']}/page", params={"worker_token": token}, headers=AUTH
    ).json()["data"]
    assert empty["items"] == []
    assert empty["has_more"] is False


def test_page_requires_worker_token(client: TestClient, db_session: Session) -> None:
    job = _create(client)
    resp = client.get(f"{BASE}/{job['id']}/page", headers=AUTH)
    # 全局参数校验处理器把缺失必填 query 映射为 400（见 core/errors.py）
    assert resp.status_code == 400


def test_page_includes_answers_and_comments_in_cursor_order(
    client: TestClient, db_session: Session
) -> None:
    ids = _seed(db_session)
    job = _create(client)
    token = _claim(client, job["id"])
    data = client.get(
        f"{BASE}/{job['id']}/page", params={"worker_token": token}, headers=AUTH
    ).json()["data"]
    assert [(item["target_type"], item["target_id"]) for item in data["items"]] == [
        ("answer", ids["answer_id"]),
        ("comment", ids["comment_id"]),
        ("question", ids["question_id"]),
    ]
    assert all(item["target_id"] != ids["hidden_id"] for item in data["items"])


def test_progress_accumulates_and_terminal_is_stable(
    client: TestClient, db_session: Session
) -> None:
    _seed(db_session)
    job = _create(client)
    token = _claim(client, job["id"])
    client.patch(
        f"{BASE}/{job['id']}/progress",
        json={
            "worker_token": token,
            "cursor_type": "answer", "cursor_id": 1, "scanned_delta": 2,
            "escalated_delta": 1, "skipped_delta": 1,
        },
        headers=AUTH,
    )
    done = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={
            "worker_token": token,
            "cursor_type": "comment", "cursor_id": 1, "scanned_delta": 1,
            "failed_delta": 1, "status": "failed", "error_summary": "模型超时",
        },
        headers=AUTH,
    )
    assert done.status_code == 200
    data = done.json()["data"]
    assert (data["scanned"], data["escalated"], data["skipped"], data["failed"]) == (3, 1, 1, 1)
    assert data["status"] == "failed"
    assert data["error_summary"] == "模型超时"
    assert data["finished_at"] is not None

    late = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={"worker_token": token, "scanned_delta": 5}, headers=AUTH,
    )
    assert late.json()["data"]["scanned"] == 3


def test_cancel_wins_over_late_progress(client: TestClient, db_session: Session) -> None:
    _seed(db_session)
    job = _create(client)
    token = _claim(client, job["id"])
    cancelled = client.post(f"{BASE}/{job['id']}/cancel", headers=AUTH)
    assert cancelled.status_code == 200
    assert cancelled.json()["data"]["status"] == "cancelled"
    assert cancelled.json()["data"]["finished_at"] is not None

    late = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={
            "worker_token": token,
            "cursor_type": "question", "cursor_id": 1, "scanned_delta": 10,
        },
        headers=AUTH,
    )
    assert late.json()["data"]["status"] == "cancelled"
    assert late.json()["data"]["scanned"] == 0

    again = client.post(f"{BASE}/{job['id']}/cancel", headers=AUTH)
    assert again.status_code == 200
    assert again.json()["data"]["status"] == "cancelled"

    page = client.get(
        f"{BASE}/{job['id']}/page", params={"worker_token": token}, headers=AUTH
    ).json()["data"]
    assert page["items"] == []


def test_invalid_cursor_and_missing_job(client: TestClient, db_session: Session) -> None:
    job = _create(client)
    token = _claim(client, job["id"])
    bad = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={"worker_token": token, "cursor_type": "question"}, headers=AUTH,
    )
    assert bad.status_code == 409
    assert client.get(f"{BASE}/9999", headers=AUTH).status_code == 404
    assert client.post(f"{BASE}/9999/cancel", headers=AUTH).status_code == 404
    assert (
        client.post(
            f"{BASE}/9999/claim", json={"worker_id": "agent-a"}, headers=AUTH
        ).status_code
        == 404
    )
