"""教师确认发布经验：建议不等于共享经验，按账号与课程校验。"""

import secrets
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.security import create_access_token
from app.db.session import get_db
from app.modules.courses.models import Course, CourseMember
from app.modules.governance import repository
from app.modules.governance.models import AgentExperience, AgentRun
from app.modules.governance.router_experiences import router
from app.modules.identity.models import User


@pytest.fixture
def data(db_session):
    users = {}
    for name, role in [("teacher", "teacher"), ("other", "teacher"),
                       ("student", "student"), ("outsider", "student"), ("admin", "admin")]:
        user = User(username=f"exp_{name}", email=f"exp_{name}@example.com", role=role,
                    password_hash=secrets.token_hex(20))
        db_session.add(user)
        users[name] = user
    db_session.flush()
    course = Course(name="经验课程", code="EXP", teacher_id=users["teacher"].id)
    db_session.add(course)
    db_session.flush()
    db_session.add(CourseMember(course_id=course.id, user_id=users["student"].id))
    db_session.commit()
    return {**users, "course": course}


@pytest.fixture
def experience_client(db_session):
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as client:
        yield client


def auth(user, service=True):
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}",
            **({"X-Service-Token": settings.agent_service_token} if service else {}),
            "X-Trace-Id": "experience-test"}


def proposal(data, **patch):
    return {"proposal_id": str(uuid4()), "course_id": data["course"].id,
            "title": "先确认题目条件", "summary": "回答前明确适用条件，再核对教材证据",
            "steps": ["检查题目限制", "读取教材原文", "列出证据和结论"], **patch}


def submit(client, data, body=None, user="student"):
    return client.post("/internal/agent/user/experience-proposals", json=body or proposal(data),
                       headers=auth(data[user]))


def decide(client, data, row_id, action="publish", user="teacher"):
    return client.post(f"/api/agent-experiences/{row_id}/{action}",
                       headers=auth(data[user], service=False))


def published(client, data, user="student"):
    return client.get(f'/internal/agent/user/courses/{data["course"].id}/experiences',
                      headers=auth(data[user]))


def test_suggestion_waits_for_teacher_before_disclosure(experience_client, data):
    client = experience_client
    body = proposal(data)
    created = submit(client, data, body)
    assert created.status_code == 200
    row = created.json()["data"]
    assert row["status"] == "pending"
    assert published(client, data).json()["data"] == []
    listing = client.get(f'/api/agent-experiences/courses/{data["course"].id}/proposals',
                         headers=auth(data["teacher"], service=False))
    assert len(listing.json()["data"]["items"]) == 1
    assert decide(client, data, row["id"]).status_code == 200
    visible = published(client, data).json()["data"]
    assert visible == [{"id": body["proposal_id"], "course_id": body["course_id"],
                        "title": body["title"], "summary": body["summary"],
                        "steps": body["steps"], "status": "published"}]
    assert "proposed_by" not in visible[0]
    assert decide(client, data, row["id"]).json()["data"]["repeat"] is True
    assert decide(client, data, row["id"], "withdraw").status_code == 200
    assert published(client, data).json()["data"] == []
    assert decide(client, data, row["id"], "withdraw").json()["data"]["repeat"] is True
    assert decide(client, data, row["id"]).status_code == 409


def test_proposal_retry_returns_same_row_but_changed_parameters_conflict(experience_client, data):
    body = proposal(data)
    first = submit(experience_client, data, body).json()["data"]
    second = submit(experience_client, data, body).json()["data"]
    assert first["id"] == second["id"]
    assert second["repeat"] is True
    assert submit(experience_client, data, {**body, "title": "替换标题"}).status_code == 409
    assert submit(experience_client, data, body, "teacher").status_code == 409


@pytest.mark.parametrize("user", ["student", "outsider", "other"])
def test_only_responsible_teacher_may_publish_or_read_pending(experience_client, data, user):
    row = submit(experience_client, data).json()["data"]
    assert decide(experience_client, data, row["id"], user=user).status_code == 403
    response = experience_client.get(
        f'/api/agent-experiences/courses/{data["course"].id}/proposals',
        headers=auth(data[user], service=False))
    assert response.status_code == 403


@pytest.mark.parametrize("user", ["outsider", "other"])
def test_unrelated_account_cannot_propose_or_read_experience(experience_client, data, user):
    assert submit(experience_client, data, user=user).status_code == 403
    assert published(experience_client, data, user).status_code == 403


def test_reject_is_idempotent_and_cannot_be_published(experience_client, data):
    row = submit(experience_client, data).json()["data"]
    assert decide(experience_client, data, row["id"], "reject").status_code == 200
    assert decide(experience_client, data, row["id"], "reject").json()["data"]["repeat"] is True
    assert decide(experience_client, data, row["id"]).status_code == 409
    assert published(experience_client, data).json()["data"] == []


@pytest.mark.parametrize("patch", [
    {"private_chat": "原始私聊"}, {"tool_rules": {"student": ["delete"]}},
    {"summary": "password=not-allowed"}, {"steps": ["联系 learner@example.com"]},
    {"summary": "原始聊天记录：某学生说"}, {"steps": []}, {"course_id": True},
])
def test_private_sensitive_or_extra_fields_are_rejected(experience_client, data, patch):
    assert submit(experience_client, data, proposal(data, **patch)).status_code == 400


def test_service_and_current_user_credentials_required(experience_client, data):
    body = proposal(data)
    route = "/internal/agent/user/experience-proposals"
    assert experience_client.post(route, json=body).status_code == 401
    assert experience_client.post(route, json=body,
                                  headers=auth(data["student"], service=False)).status_code == 401
    response = experience_client.post(
        route, json=body, headers={"X-Service-Token": settings.agent_service_token},
    )
    assert response.status_code == 401


def test_teacher_revocation_after_proposal_is_honored(experience_client, data, db_session):
    row = submit(experience_client, data).json()["data"]
    headers = auth(data["teacher"], service=False)
    data["teacher"].role = "student"
    db_session.commit()
    response = experience_client.post(
        f'/api/agent-experiences/{row["id"]}/publish', headers=headers,
    )
    assert response.status_code == 403


def test_proposal_failure_rolls_back_its_audit_run(
    experience_client, data, db_session, monkeypatch,
):
    def fail(*args, **kwargs):
        raise RuntimeError("simulated write failure")

    monkeypatch.setattr(repository, "create_experience", fail)
    with pytest.raises(RuntimeError, match="simulated write failure"):
        submit(experience_client, data)
    assert db_session.query(AgentRun).filter_by(task_type="experience_proposal").count() == 0
    assert db_session.query(AgentExperience).count() == 0


def test_corrupt_sensitive_suggestion_cannot_publish_but_can_be_rejected(
    experience_client, data, db_session,
):
    row = submit(experience_client, data).json()["data"]
    stored = db_session.get(AgentExperience, row["id"])
    stored.summary = "password should never be published"
    db_session.commit()
    assert decide(experience_client, data, row["id"]).status_code == 400
    assert decide(experience_client, data, row["id"], "reject").status_code == 200
