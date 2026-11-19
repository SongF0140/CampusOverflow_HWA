"""AP-01：管理员双鉴权读取治理状态，不执行任何业务写入。"""

import secrets
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.courses.models import Course
from app.modules.identity.models import User
from app.modules.qa.models import Answer, Comment, Question

PREFIX = "/internal/agent/user/governance-targets"


@pytest.fixture
def graph(db_session: Session) -> dict:
    users = {}
    for role in ("admin", "teacher", "student"):
        user = User(
            username=f"state_{role}", email=f"state_{role}@example.com",
            password_hash=secrets.token_hex(24), role=role,
        )
        db_session.add(user)
        users[role] = user
    db_session.flush()
    course = Course(name="状态课程", code="STATE", teacher_id=users["teacher"].id)
    db_session.add(course)
    db_session.flush()
    question = Question(
        title="状态问题", body="不应返回的正文", course_id=course.id,
        author_id=users["student"].id,
    )
    db_session.add(question)
    db_session.flush()
    answer = Answer(body="不应返回的回答", question_id=question.id, author_id=users["student"].id)
    db_session.add(answer)
    db_session.flush()
    comment = Comment(body="不应返回的评论", answer_id=answer.id, author_id=users["student"].id)
    db_session.add(comment)
    db_session.commit()
    return {**users, "question": question, "answer": answer, "comment": comment}


def headers(user: User, claimed_role: str | None = None) -> dict[str, str]:
    return {
        "X-Service-Token": settings.agent_service_token,
        "Authorization": f"Bearer {create_access_token(user.id, claimed_role or user.role)}",
        "X-Trace-Id": "state-check",
    }


@pytest.mark.parametrize("kind", ["question", "answer", "comment"])
@pytest.mark.parametrize("state", ["ready", "hidden", "deleted"])
def test_content_state_is_current_and_minimal(
    client: TestClient, db_session: Session, graph: dict, kind: str, state: str,
) -> None:
    target = graph[kind]
    if state == "hidden":
        target.is_hidden = True
    if state == "deleted":
        target.deleted_at = datetime(2026, 1, 1)
    db_session.commit()
    response = client.get(f"{PREFIX}/{kind}/{target.id}/state", headers=headers(graph["admin"]))
    assert response.status_code == 200
    assert response.json()["data"] == {
        "target_type": kind, "target_id": target.id, "current_state": state,
    }
    assert response.headers["X-Trace-Id"] == "state-check"
    assert "不应返回" not in response.text
    db_session.refresh(graph["question"])
    assert graph["question"].view_count == 0


@pytest.mark.parametrize("kind", ["question", "answer", "comment", "user"])
def test_missing_is_reported(client: TestClient, graph: dict, kind: str) -> None:
    response = client.get(f"{PREFIX}/{kind}/999999/state", headers=headers(graph["admin"]))
    assert response.status_code == 200
    assert response.json()["data"]["current_state"] == "missing"


@pytest.mark.parametrize(
    "bad_part", ["service-missing", "service-wrong", "user-missing", "user-wrong"],
)
def test_both_credentials_required(client: TestClient, graph: dict, bad_part: str) -> None:
    auth = headers(graph["admin"])
    key = "X-Service-Token" if bad_part.startswith("service") else "Authorization"
    if bad_part.endswith("missing"):
        del auth[key]
    else:
        auth[key] = secrets.token_hex(24) if key == "X-Service-Token" else "Bearer invalid"
    response = client.get(f"{PREFIX}/question/1/state", headers=auth)
    assert response.status_code == 401


@pytest.mark.parametrize("role", ["student", "teacher"])
def test_forged_admin_role_cannot_override_database(
    client: TestClient, graph: dict, role: str,
) -> None:
    response = client.get(f"{PREFIX}/question/1/state", headers=headers(graph[role], "admin"))
    assert response.status_code == 403


def test_current_admin_role_overrides_stale_jwt(client: TestClient, graph: dict) -> None:
    response = client.get(f"{PREFIX}/question/1/state", headers=headers(graph["admin"], "student"))
    assert response.status_code == 200


def test_banned_admin_denied(client: TestClient, db_session: Session, graph: dict) -> None:
    auth = headers(graph["admin"])
    graph["admin"].status = "banned"
    db_session.commit()
    assert client.get(f"{PREFIX}/question/1/state", headers=auth).status_code == 403


@pytest.mark.parametrize("path", ["unknown/1", "question/0", "user/-1"])
def test_invalid_target_rejected(client: TestClient, graph: dict, path: str) -> None:
    assert client.get(f"{PREFIX}/{path}/state", headers=headers(graph["admin"])).status_code == 400


@pytest.mark.parametrize("state", ["active", "banned"])
def test_user_state_read_does_not_write_or_expire_ban(
    client: TestClient, db_session: Session, graph: dict, state: str,
) -> None:
    target = graph["student"]
    target.status = state
    target.ban_reason = "不应返回的原因"
    target.banned_until = datetime(2000, 1, 1) if state == "banned" else None
    db_session.commit()
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement.lstrip().split()[0].upper())

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = client.get(f"{PREFIX}/user/{target.id}/state", headers=headers(graph["admin"]))
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200
    assert response.json()["data"] == {
        "target_type": "user", "target_id": target.id, "current_state": state,
    }
    assert not {"INSERT", "UPDATE", "DELETE"}.intersection(statements)
    assert "example.com" not in response.text
    assert target.password_hash not in response.text
    assert "不应返回" not in response.text
    db_session.refresh(target)
    assert target.status == state
