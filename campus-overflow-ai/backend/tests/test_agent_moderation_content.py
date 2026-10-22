"""G-03-C：正文读取只读、双鉴权，并遵循目标及父级内容可见性。"""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.courses.models import Course
from app.modules.identity.models import User
from app.modules.qa.models import Answer, Comment, Question

PREFIX = "/internal/agent/user/moderation-targets"


@pytest.fixture
def content_graph(db_session: Session) -> dict:
    user = User(username="content_reader", email="private@example.com", password_hash="private")
    db_session.add(user)
    db_session.flush()
    course = Course(name="测试课程", code="CONTENT", teacher_id=user.id)
    db_session.add(course)
    db_session.flush()
    question = Question(title="公开问题", body="问题原文", course_id=course.id, author_id=user.id)
    db_session.add(question)
    db_session.flush()
    answer = Answer(body="回答原文", question_id=question.id, author_id=user.id)
    db_session.add(answer)
    db_session.flush()
    comments = {
        "question_comment": Comment(body="问题评论", question_id=question.id, author_id=user.id),
        "answer_comment": Comment(body="回答评论", answer_id=answer.id, author_id=user.id),
    }
    db_session.add_all(comments.values())
    db_session.flush()
    reply = Comment(
        body="二级回复", answer_id=answer.id, author_id=user.id,
        parent_id=comments["answer_comment"].id,
    )
    db_session.add(reply)
    db_session.commit()
    return {
        "user": user, "course": course, "question": question, "answer": answer,
        **comments, "reply": reply,
        "headers": {
            "X-Service-Token": settings.agent_service_token,
            "Authorization": f"Bearer {create_access_token(user.id, user.role)}",
            "X-Trace-Id": "trace-content-read",
        },
    }


@pytest.mark.parametrize(
    "target", ["question", "answer", "question_comment", "answer_comment", "reply"],
)
def test_visible_target_returns_minimal_body_without_incrementing_views(
    client: TestClient, db_session: Session, content_graph: dict, target: str,
) -> None:
    graph = content_graph
    row = graph[target]
    target_type = target if target in {"question", "answer"} else "comment"
    response = client.get(f"{PREFIX}/{target_type}/{row.id}", headers=graph["headers"])
    assert response.status_code == 200
    assert response.json()["data"] == {
        "target_type": target_type, "target_id": row.id, "author_id": graph["user"].id,
        "course_id": graph["course"].id, "title": graph["question"].title, "body": row.body,
    }
    assert response.headers["X-Trace-Id"] == "trace-content-read"
    assert "private" not in response.text
    db_session.refresh(graph["question"])
    assert graph["question"].view_count == 0


@pytest.mark.parametrize(
    "target", ["question", "answer", "question_comment", "answer_comment", "reply"],
)
@pytest.mark.parametrize("state", ["hidden", "deleted"])
def test_invisible_target_is_not_returned(
    client: TestClient, db_session: Session, content_graph: dict, target: str, state: str,
) -> None:
    row = content_graph[target]
    if state == "hidden":
        row.is_hidden = True
    else:
        row.deleted_at = datetime.now(UTC)
    db_session.commit()
    target_type = target if target in {"question", "answer"} else "comment"
    response = client.get(
        f"{PREFIX}/{target_type}/{row.id}", headers=content_graph["headers"],
    )
    assert response.status_code == 404
    assert response.json()["data"] is None


@pytest.mark.parametrize(
    ("parent", "child", "target_type"),
    [
        ("question", "answer", "answer"),
        ("question", "question_comment", "comment"),
        ("question", "answer_comment", "comment"),
        ("answer", "answer_comment", "comment"),
        ("answer_comment", "reply", "comment"),
    ],
)
@pytest.mark.parametrize("state", ["hidden", "deleted"])
def test_invisible_ancestor_hides_descendants(
    client: TestClient, db_session: Session, content_graph: dict,
    parent: str, child: str, target_type: str, state: str,
) -> None:
    graph = content_graph
    if state == "hidden":
        graph[parent].is_hidden = True
    else:
        graph[parent].deleted_at = datetime.now(UTC)
    db_session.commit()
    response = client.get(
        f"{PREFIX}/{target_type}/{graph[child].id}", headers=graph["headers"],
    )
    assert response.status_code == 404
    assert response.json()["data"] is None


@pytest.mark.parametrize("invalid", ["service", "user", "banned", "bad-jwt"])
def test_body_endpoint_rechecks_authentication(
    client: TestClient, db_session: Session, content_graph: dict, invalid: str,
) -> None:
    headers = dict(content_graph["headers"])
    if invalid == "service":
        headers.pop("X-Service-Token")
    elif invalid == "user":
        headers.pop("Authorization")
    elif invalid == "bad-jwt":
        headers["Authorization"] = "Bearer bad-jwt"
    else:
        content_graph["user"].status = "banned"
        db_session.commit()
    response = client.get(
        f"{PREFIX}/question/{content_graph['question'].id}", headers=headers,
    )
    assert response.status_code == (403 if invalid == "banned" else 401)


def test_missing_target_and_invalid_parameters(client: TestClient, content_graph: dict) -> None:
    headers = content_graph["headers"]
    assert client.get(f"{PREFIX}/answer/999999", headers=headers).status_code == 404
    assert client.get(f"{PREFIX}/user/1", headers=headers).status_code == 400
    assert client.get(f"{PREFIX}/question/0", headers=headers).status_code == 400


def test_body_response_contract_is_declared_in_openapi(client: TestClient) -> None:
    document = client.get("/openapi.json").json()
    operation = document["paths"][f"{PREFIX}/{{target_type}}/{{target_id}}"]["get"]
    schema = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert "$ref" in schema
