"""G-02 用户检索入口：每次请求双凭证验证，沿用公开数据可见性。"""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.courses.models import Course
from app.modules.identity.models import User
from app.modules.qa.models import Question

SEARCHES = [
    ("/internal/agent/user/courses/search", {"keyword": "课程"}),
    ("/internal/agent/user/questions/search", {"keyword": "TCP"}),
    ("/internal/agent/user/tags", {}),
]


@pytest.fixture
def actor(db_session: Session) -> User:
    user = User(username="agent_reader", email="reader@example.com", password_hash="unused")
    db_session.add(user)
    db_session.commit()
    return user


def user_headers(user: User) -> dict[str, str]:
    return {
        "X-Service-Token": settings.agent_service_token,
        "Authorization": f"Bearer {create_access_token(user.id, user.role)}",
    }


@pytest.mark.parametrize(("path", "params"), SEARCHES)
@pytest.mark.parametrize("missing", ["service", "user"])
def test_user_searches_require_both_credentials(
    client: TestClient, actor: User, path: str, params: dict, missing: str,
) -> None:
    headers = user_headers(actor)
    headers.pop("X-Service-Token" if missing == "service" else "Authorization")
    response = client.get(path, params=params, headers=headers)
    assert response.status_code == 401


@pytest.mark.parametrize(("path", "params"), SEARCHES)
def test_user_status_is_rechecked_after_principal_resolution(
    client: TestClient, db_session: Session, actor: User, path: str, params: dict,
) -> None:
    headers = user_headers(actor)
    assert client.get("/internal/agent/principal", headers=headers).status_code == 200
    actor.status = "banned"
    db_session.commit()

    response = client.get(path, params=params, headers=headers)

    assert response.status_code == 403


@pytest.mark.parametrize(("path", "params"), SEARCHES)
@pytest.mark.parametrize("role", ["student", "teacher", "admin"])
def test_active_roles_can_read_shared_data(
    client: TestClient, db_session: Session, actor: User, path: str, params: dict, role: str,
) -> None:
    actor.role = role
    db_session.commit()
    response = client.get(path, params=params, headers=user_headers(actor))
    assert response.status_code == 200
    assert response.json()["data"] == {"items": [], "total": 0}


def test_public_question_scope_excludes_hidden_deleted_and_other_courses(
    client: TestClient, db_session: Session, actor: User,
) -> None:
    teacher = User(
        username="scope_teacher", email="teacher@example.com", password_hash="unused",
        role="teacher",
    )
    db_session.add(teacher)
    db_session.flush()
    courses = [Course(name=f"课程{i}", code=f"SCOPE{i}", teacher_id=teacher.id) for i in range(2)]
    db_session.add_all(courses)
    db_session.flush()
    visible = Question(
        title="TCP公开", body="公开内容", course_id=courses[0].id, author_id=teacher.id,
    )
    rows = [
        visible,
        Question(title="TCP隐藏", body="隐藏内容", course_id=courses[0].id,
                 author_id=teacher.id, is_hidden=True),
        Question(title="TCP删除", body="已删内容", course_id=courses[0].id,
                 author_id=teacher.id, deleted_at=datetime.now(UTC)),
        Question(title="TCP其他课", body="另一课程", course_id=courses[1].id, author_id=teacher.id),
    ]
    db_session.add_all(rows)
    db_session.commit()

    # 未选课用户仍可读公开问题，与现有业务读接口一致；不授予成员管理权限。
    response = client.get(
        "/internal/agent/user/questions/search",
        params={"keyword": "TCP", "course_id": courses[0].id}, headers=user_headers(actor),
    )

    assert response.status_code == 200
    assert response.json()["data"]["total"] == 1
    assert [item["id"] for item in response.json()["data"]["items"]] == [visible.id]


@pytest.mark.parametrize(("path", "params"), SEARCHES)
def test_legacy_service_search_contract_is_preserved(
    client: TestClient, path: str, params: dict,
) -> None:
    response = client.get(
        path.replace("/user/", "/"), params=params,
        headers={"X-Service-Token": settings.agent_service_token},
    )
    assert response.status_code == 200
