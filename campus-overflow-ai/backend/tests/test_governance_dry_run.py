"""治理 dry-run：只读影响预演，不建单、不改状态、不写审计。"""

import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.courses.models import Course
from app.modules.governance.models import ModerationCase
from app.modules.identity.models import User
from app.modules.qa.models import Answer, Comment, Question

ROOT = "/internal/agent/user"


@pytest.fixture
def setup(db_session: Session) -> dict:
    admin = User(
        username="dryrun_admin", email="dryrun_admin@example.com", role="admin",
        password_hash=secrets.token_hex(24),
    )
    student = User(
        username="dryrun_student", email="dryrun_student@example.com", role="student",
        password_hash=secrets.token_hex(24),
    )
    db_session.add_all([admin, student])
    db_session.flush()
    course = Course(name="预演课程", code="DRYRUN", teacher_id=admin.id)
    db_session.add(course)
    db_session.flush()
    question = Question(
        title="什么是死锁", body="请解释死锁与预防。",
        author_id=student.id, course_id=course.id,
    )
    db_session.add(question)
    db_session.flush()
    answer = Answer(body="按固定顺序加锁。", question_id=question.id, author_id=student.id)
    db_session.add(answer)
    db_session.flush()
    question_comment = Comment(
        body="问题评论", author_id=student.id, question_id=question.id,
    )
    answer_comment = Comment(
        body="回答评论", author_id=student.id, answer_id=answer.id,
    )
    db_session.add_all([question_comment, answer_comment])
    db_session.flush()
    reply = Comment(
        body="评论回复", author_id=student.id, question_id=question.id,
        parent_id=question_comment.id,
    )
    db_session.add(reply)
    db_session.commit()
    return {
        "admin": admin, "student": student, "question": question,
        "answer": answer, "comment": question_comment, "reply": reply,
    }


def auth(user: User) -> dict:
    return {
        "Authorization": f"Bearer {create_access_token(user.id, user.role)}",
        "X-Service-Token": settings.agent_service_token,
        "X-Trace-Id": "governance-dry-run-trace",
    }


def version(client: TestClient, setup: dict, target_type: str, target_id: int) -> str:
    response = client.get(
        f"{ROOT}/governance-targets/{target_type}/{target_id}/state"
        "?include_version=true",
        headers=auth(setup["admin"]),
    )
    assert response.status_code == 200
    return response.json()["data"]["state_version"]


def dry_run(client: TestClient, setup: dict, body: dict) -> dict:
    return client.post(
        f"{ROOT}/governance-dry-run", json=body, headers=auth(setup["admin"])
    )


def test_question_dry_run_returns_impact_without_writes(
    client: TestClient, db_session: Session, setup: dict
) -> None:
    question = setup["question"]
    body = {
        "target_type": "question",
        "target_id": question.id,
        "action": "delete",
        "expected_version": version(client, setup, "question", question.id),
    }
    response = dry_run(client, setup, body)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["impact"] == {"answers": 1, "comments": 3, "total": 4}
    assert data["would_change"] is True
    assert data["current_state"] == "ready"
    assert "软删除" in data["warnings"][0]

    db_session.expire_all()
    row = db_session.get(Question, question.id)
    assert row is not None and row.is_hidden is False and row.deleted_at is None
    assert db_session.query(ModerationCase).count() == 0


def test_answer_and_comment_impact(client: TestClient, setup: dict) -> None:
    answer = setup["answer"]
    answer_body = {
        "target_type": "answer",
        "target_id": answer.id,
        "action": "hide",
        "expected_version": version(client, setup, "answer", answer.id),
    }
    answer_data = dry_run(client, setup, answer_body).json()["data"]
    assert answer_data["impact"] == {"comments": 1, "total": 1}

    comment = setup["comment"]
    comment_body = {
        "target_type": "comment",
        "target_id": comment.id,
        "action": "delete",
        "expected_version": version(client, setup, "comment", comment.id),
    }
    comment_data = dry_run(client, setup, comment_body).json()["data"]
    assert comment_data["impact"] == {"replies": 1, "total": 1}


def test_user_ban_impact_and_no_status_change(
    client: TestClient, db_session: Session, setup: dict
) -> None:
    student = setup["student"]
    body = {
        "target_type": "user",
        "target_id": student.id,
        "action": "ban_temp",
        "duration_days": 7,
        "expected_version": version(client, setup, "user", student.id),
    }
    response = dry_run(client, setup, body)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["impact"]["questions"] == 1
    assert data["impact"]["answers"] == 1
    assert data["impact"]["comments"] == 3

    db_session.expire_all()
    assert db_session.get(User, student.id).status == "active"
    assert db_session.query(ModerationCase).count() == 0


def test_stale_version_and_mismatch_rejected(client: TestClient, setup: dict) -> None:
    question = setup["question"]
    stale = {
        "target_type": "question",
        "target_id": question.id,
        "action": "hide",
        "expected_version": "0" * 64,
    }
    assert dry_run(client, setup, stale).status_code == 409

    mismatch = {
        "target_type": "question",
        "target_id": question.id,
        "action": "ban",
        "expected_version": version(client, setup, "question", question.id),
    }
    assert dry_run(client, setup, mismatch).status_code == 400


def test_missing_service_token_rejected(client: TestClient, setup: dict) -> None:
    question = setup["question"]
    response = client.post(
        f"{ROOT}/governance-dry-run",
        json={
            "target_type": "question",
            "target_id": question.id,
            "action": "hide",
            "expected_version": version(client, setup, "question", question.id),
        },
        headers={"Authorization": auth(setup["admin"])["Authorization"]},
    )
    assert response.status_code == 401
