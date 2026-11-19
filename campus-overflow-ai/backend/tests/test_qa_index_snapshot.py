# 问答索引快照导出：仅可见问题、游标分页、服务间鉴权；候选复核必须双凭证。
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.courses.models import Course
from app.modules.identity.models import User
from app.modules.qa.models import Question

AUTH = {"X-Service-Token": settings.agent_service_token}
CANDIDATES = "/internal/agent/user/qa-index/candidates"


def _question(db: Session, title: str, course_id: int = 1, **kwargs) -> Question:
    row = Question(
        title=title, body="正文不导出", course_id=course_id, author_id=1,
        status="published", created_at=datetime(2026, 11, 1), **kwargs,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def user_headers(db_session: Session) -> dict[str, str]:
    user = User(username="snapshot_reader", email="snapshot@example.com", password_hash="hidden")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return {
        "X-Service-Token": settings.agent_service_token,
        "Authorization": f"Bearer {create_access_token(user.id, user.role)}",
    }


def test_export_excludes_hidden_and_deleted(client: TestClient, db_session: Session) -> None:
    visible = _question(db_session, "可见问题")
    _question(db_session, "隐藏问题", is_hidden=True)
    _question(db_session, "已删问题", deleted_at=datetime(2026, 11, 2))

    resp = client.get("/internal/agent/qa-index/snapshot", headers=AUTH)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert [item["id"] for item in data["items"]] == [visible.id]
    assert data["next_cursor"] is None
    assert set(data["items"][0]) == {
        "id", "title", "course_id", "status", "tag_ids", "updated_at",
    }


def test_cursor_pagination_and_auth(client: TestClient, db_session: Session) -> None:
    first = _question(db_session, "一")
    second = _question(db_session, "二")

    page1 = client.get(
        "/internal/agent/qa-index/snapshot?limit=1", headers=AUTH,
    ).json()["data"]
    assert [item["id"] for item in page1["items"]] == [first.id]
    assert page1["next_cursor"] == first.id

    page2 = client.get(
        f"/internal/agent/qa-index/snapshot?limit=1&cursor={page1['next_cursor']}",
        headers=AUTH,
    ).json()["data"]
    assert [item["id"] for item in page2["items"]] == [second.id]

    assert client.get("/internal/agent/qa-index/snapshot").status_code == 401


def test_candidates_review_keeps_only_visible_and_candidate_order(
    client: TestClient, db_session: Session, user_headers: dict[str, str],
) -> None:
    first = _question(db_session, "候选一")
    hidden = _question(db_session, "隐藏候选", is_hidden=True)
    deleted = _question(db_session, "已删候选", deleted_at=datetime(2026, 11, 2))
    second = _question(db_session, "候选二")

    resp = client.post(CANDIDATES, headers=user_headers, json={
        "ids": [second.id, hidden.id, 999_999, deleted.id, first.id, second.id],
    })

    assert resp.status_code == 200
    data = resp.json()["data"]
    assert [item["id"] for item in data["items"]] == [second.id, first.id]
    assert data["total"] == 2
    assert set(data["items"][0]) == {
        "id", "title", "course_id", "status", "tag_ids", "updated_at",
    }


def test_candidates_review_limits_to_course(
    client: TestClient, db_session: Session, user_headers: dict[str, str],
) -> None:
    course = Course(name="候选课程", code="CAND", teacher_id=1)
    other = Course(name="其他课程", code="OTHER", teacher_id=1)
    db_session.add_all([course, other])
    db_session.commit()
    db_session.refresh(course)
    db_session.refresh(other)
    inside = _question(db_session, "课内候选", course_id=course.id)
    outside = _question(db_session, "课外候选", course_id=other.id)

    resp = client.post(CANDIDATES, headers=user_headers, json={
        "ids": [inside.id, outside.id], "course_id": course.id,
    })

    assert resp.status_code == 200
    assert [item["id"] for item in resp.json()["data"]["items"]] == [inside.id]


def test_candidates_review_requires_both_credentials(
    client: TestClient, db_session: Session, user_headers: dict[str, str],
) -> None:
    question = _question(db_session, "候选鉴权")

    assert client.post(CANDIDATES, json={"ids": [question.id]}).status_code == 401
    assert client.post(
        CANDIDATES, headers=AUTH, json={"ids": [question.id]},
    ).status_code == 401
    assert client.post(
        CANDIDATES,
        headers={"X-Service-Token": settings.agent_service_token,
                 "Authorization": "Bearer invalid"},
        json={"ids": [question.id]},
    ).status_code == 401
    # 缺少 trace id 时由服务端生成并回写响应头
    ok_resp = client.post(CANDIDATES, headers=user_headers, json={"ids": [question.id]})
    assert ok_resp.status_code == 200
    assert ok_resp.headers["X-Trace-Id"]

    assert client.post(
        CANDIDATES, headers=user_headers, json={"ids": []},
    ).status_code == 400
    assert client.post(
        CANDIDATES, headers=user_headers, json={"ids": list(range(1, 52))},
    ).status_code == 400
