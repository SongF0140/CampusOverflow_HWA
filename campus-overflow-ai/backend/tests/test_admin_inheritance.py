"""管理员继承教师能力，仍不绕过确认和学生能力位。"""

import hashlib
import json
from uuid import uuid4

import pytest
import test_answer_certification as certification
import test_experiences as experiences
from fastapi import HTTPException

from app.core.config import settings
from app.core.permissions import UserPrincipal, require_roles
from app.modules.courses.models import CourseMember


@pytest.fixture
def data(db_session):
    return experiences.data.__wrapped__(db_session)


def test_teacher_role_gate_includes_admin_but_student_gate_does_not():
    admin = UserPrincipal(1, "admin", "active")
    assert require_roles("teacher")(admin) is admin
    with pytest.raises(HTTPException) as error:
        require_roles("student")(admin)
    assert error.value.status_code == 403


def test_admin_manages_foreign_class_only_after_human_confirmation(client, db_session, data):
    body = {
        "request_id": str(uuid4()),
        "course_id": data["course"].id,
        "student_ids": [data["outsider"].id],
        "action": "add",
    }
    response = client.post(
        "/internal/agent/user/class-changes", json=body, headers=experiences.auth(data["admin"])
    )
    assert response.status_code == 200
    assert response.json()["data"]["executed"] is False
    assert not db_session.query(CourseMember).filter_by(user_id=data["outsider"].id).count()
    path = f"/api/class-changes/{body['request_id']}/confirm"
    approved = client.post(path, headers=experiences.auth(data["admin"], False))
    assert approved.status_code == 200
    assert approved.json()["data"]["executed"] is True
    assert client.post(path, headers=experiences.auth(data["admin"], False)).status_code == 200
    assert db_session.query(CourseMember).filter_by(user_id=data["outsider"].id).count() == 1
    denied = client.post(
        "/internal/agent/user/class-changes",
        json={**body, "request_id": str(uuid4())},
        headers=experiences.auth(data["other"]),
    )
    assert denied.status_code == 403


def test_admin_reviews_teacher_experience_across_courses(client, data):
    proposed = client.post(
        "/internal/agent/user/experience-proposals",
        json=experiences.proposal(data),
        headers=experiences.auth(data["teacher"]),
    )
    row_id = proposed.json()["data"]["id"]
    path = f"/api/agent-experiences/{row_id}/publish"
    response = client.post(path, headers=experiences.auth(data["admin"], False))
    assert response.status_code == 200
    assert response.json()["data"]["reviewed_by"] == data["admin"].id
    assert client.post(path, headers=experiences.auth(data["other"], False)).status_code == 403


def test_admin_can_use_teacher_course_and_review_endpoints(client, data):
    headers = experiences.auth(data["admin"], False)
    assert client.get("/api/users/assistant-certifications", headers=headers).status_code == 200
    course = data["course"].id
    response = client.post(
        f"/api/courses/{course}/knowledge-tree/nodes",
        json={"names": ["继承权限知识点"]},
        headers=headers,
    )
    assert response.status_code == 200
    assert client.get(f"/api/courses/{course}/weekly-reports", headers=headers).status_code == 200
    assert (
        client.get(f"/api/learning/courses/{course}/feedback", headers=headers).status_code == 200
    )


def test_admin_can_certify_students_on_foreign_course(client, db_session):
    data = certification.setup.__wrapped__(db_session)
    result = certification.certify(client, data, "admin")
    assert result.status_code == 200
    assert result.json()["data"]["certified_by_teacher"] is True
    assert not result.json()["data"].get("certified_by_assistant", False)


def test_external_admin_can_propose_but_cannot_confirm_without_human_login(
    client, data, monkeypatch
):
    key = "admin-inheritance-fixture"
    monkeypatch.setattr(
        settings,
        "external_agent_keys",
        json.dumps(
            [
                {
                    "key_hash": hashlib.sha256(key.encode()).hexdigest(),
                    "user_id": data["admin"].id,
                    "enabled": True,
                }
            ]
        ),
    )
    headers = {"X-Service-Token": settings.agent_service_token, "X-External-Agent-Key": key}
    body = {
        "request_id": str(uuid4()),
        "course_id": data["course"].id,
        "student_ids": [data["outsider"].id],
        "action": "add",
    }
    assert (
        client.post("/internal/agent/user/class-changes", headers=headers, json=body).status_code
        == 200
    )
    assert (
        client.post(f"/api/class-changes/{body['request_id']}/confirm", headers=headers).status_code
        == 401
    )
    suggested = client.post(
        "/internal/agent/user/experience-proposals",
        headers=headers,
        json=experiences.proposal(data),
    )
    assert suggested.status_code == 200
    assert (
        client.post(
            f"/api/agent-experiences/{suggested.json()['data']['id']}/publish", headers=headers
        ).status_code
        == 401
    )


def test_admin_can_confirm_teacher_request_and_audit_uses_real_admin(client, db_session, data):
    from app.modules.governance.models import AgentRun, ClassChangeRequest

    request_id = str(uuid4())
    response = client.post(
        "/internal/agent/user/class-changes",
        headers=experiences.auth(data["teacher"]),
        json={
            "request_id": request_id,
            "course_id": data["course"].id,
            "student_ids": [data["outsider"].id],
            "action": "add",
        },
    )
    assert response.status_code == 200
    assert (
        client.post(
            f"/api/class-changes/{request_id}/confirm",
            headers=experiences.auth(data["admin"], False),
        ).status_code
        == 200
    )
    run = db_session.query(AgentRun).filter_by(agent_run_id=f"class-apply-{request_id}").one()
    assert run.user_id == data["admin"].id
    assert db_session.get(ClassChangeRequest, request_id).teacher_id == data["teacher"].id


def test_admin_can_publish_as_teaching_staff_without_fake_ownership(client, data):
    headers = experiences.auth(data["admin"], False)
    course_id = data["course"].id
    detail = client.get(f"/api/courses/{course_id}", headers=headers).json()["data"]
    assert detail["is_owner"] is False
    assert detail["can_post"] is True
    response = client.post("/api/questions", headers=headers, json={
        "title": "管理员教学提问", "body": "以教学管理身份发布", "course_id": course_id,
    })
    assert response.status_code == 200
