# P2 管理员全量扫描任务：服务间鉴权、创建/查询/取消、分批游标与终态保护。
import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.modules.courses.models import Course
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


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", BASE),
        ("get", f"{BASE}/1"),
        ("post", f"{BASE}/1/cancel"),
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


def test_page_cursor_and_target_filter(client: TestClient, db_session: Session) -> None:
    ids = _seed(db_session)
    job = _create(client, {"target_types": ["question"]})

    first = client.get(f"{BASE}/{job['id']}/page", params={"limit": 1}, headers=AUTH)
    assert first.status_code == 200
    data = first.json()["data"]
    assert [item["target_type"] for item in data["items"]] == ["question"]
    assert data["items"][0]["target_id"] == ids["question_id"]
    assert data["has_more"] is False

    progress = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={
            "cursor_type": "question", "cursor_id": ids["question_id"],
            "scanned_delta": 1, "status": "succeeded",
        },
        headers=AUTH,
    )
    assert progress.status_code == 200
    assert progress.json()["data"]["scanned"] == 1
    assert progress.json()["data"]["status"] == "succeeded"

    empty = client.get(f"{BASE}/{job['id']}/page", headers=AUTH).json()["data"]
    assert empty["items"] == []
    assert empty["has_more"] is False


def test_page_includes_answers_and_comments_in_cursor_order(
    client: TestClient, db_session: Session
) -> None:
    ids = _seed(db_session)
    job = _create(client)
    data = client.get(f"{BASE}/{job['id']}/page", headers=AUTH).json()["data"]
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
    client.patch(
        f"{BASE}/{job['id']}/progress",
        json={
            "cursor_type": "answer", "cursor_id": 1, "scanned_delta": 2,
            "escalated_delta": 1, "skipped_delta": 1,
        },
        headers=AUTH,
    )
    done = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={
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
        json={"scanned_delta": 5}, headers=AUTH,
    )
    assert late.json()["data"]["scanned"] == 3


def test_cancel_wins_over_late_progress(client: TestClient, db_session: Session) -> None:
    _seed(db_session)
    job = _create(client)
    cancelled = client.post(f"{BASE}/{job['id']}/cancel", headers=AUTH)
    assert cancelled.status_code == 200
    assert cancelled.json()["data"]["status"] == "cancelled"
    assert cancelled.json()["data"]["finished_at"] is not None

    late = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={"cursor_type": "question", "cursor_id": 1, "scanned_delta": 10},
        headers=AUTH,
    )
    assert late.json()["data"]["status"] == "cancelled"
    assert late.json()["data"]["scanned"] == 0

    again = client.post(f"{BASE}/{job['id']}/cancel", headers=AUTH)
    assert again.status_code == 200
    assert again.json()["data"]["status"] == "cancelled"

    page = client.get(f"{BASE}/{job['id']}/page", headers=AUTH).json()["data"]
    assert page["items"] == []


def test_invalid_cursor_and_missing_job(client: TestClient, db_session: Session) -> None:
    job = _create(client)
    bad = client.patch(
        f"{BASE}/{job['id']}/progress",
        json={"cursor_type": "question"}, headers=AUTH,
    )
    assert bad.status_code == 409
    assert client.get(f"{BASE}/9999", headers=AUTH).status_code == 404
    assert client.post(f"{BASE}/9999/cancel", headers=AUTH).status_code == 404
