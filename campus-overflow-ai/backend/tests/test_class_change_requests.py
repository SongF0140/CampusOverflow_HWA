import pytest
import test_approval_requests as requests

from app.modules.courses.models import CourseMember


@pytest.fixture
def data(db_session):
    data = requests.setup.__wrapped__(db_session)
    data["admin"].role = "teacher"
    db_session.commit()
    return data


def propose(client, data, **changes):
    from uuid import uuid4
    body = {"request_id": str(uuid4()), "course_id": data["question"].course_id,
            "student_ids": [data["student"].id], "action": "add"}
    body.update(changes)
    return client.post("/internal/agent/user/class-changes", json=body,
                       headers=requests.auth(data["admin"]))


def test_teacher_proposal_does_not_change_roster_until_confirm(client, db_session, data):
    response = propose(client, data)
    assert response.status_code == 200
    change = response.json()["data"]
    assert change["status"] == "pending"
    assert change["students"][0]["username"] == data["student"].username
    assert db_session.query(CourseMember).count() == 0
    path = f"/api/class-changes/{change['request_id']}/confirm"
    first = client.post(path, headers=requests.auth(data["admin"], service=False))
    assert first.status_code == 200
    assert first.json()["data"]["status"] == "executed"
    assert db_session.query(CourseMember).count() == 1
    repeated = client.post(path, headers=requests.auth(data["admin"], service=False))
    assert repeated.json()["data"]["status"] == "executed"
    assert db_session.query(CourseMember).count() == 1


def test_other_teacher_student_and_service_cannot_confirm(client, data):
    change = propose(client, data).json()["data"]
    path = f"/api/class-changes/{change['request_id']}/confirm"
    student_result = client.post(path, headers=requests.auth(data["student"], service=False))
    assert student_result.status_code == 403
    assert client.post(path, headers=requests.auth(data["other"], service=False)).status_code == 403
    assert client.post(path, headers={"X-Service-Token": "dev-agent-token"}).status_code == 401


def test_changed_membership_rejects_stale_confirmation(client, db_session, data):
    change = propose(client, data).json()["data"]
    db_session.add(CourseMember(course_id=data["question"].course_id, user_id=data["student"].id))
    db_session.commit()
    response = client.post(f"/api/class-changes/{change['request_id']}/confirm",
                           headers=requests.auth(data["admin"], service=False))
    assert response.status_code == 409


def test_student_cannot_request_roster_changes(client, data):
    result = propose(client, data, student_ids=[data["other"].id])
    assert result.status_code in {400, 403}


def test_student_role_cannot_propose_even_for_own_membership(client, data):
    from uuid import uuid4
    response = client.post(
        "/internal/agent/user/class-changes", headers=requests.auth(data["student"]),
        json={"request_id": str(uuid4()), "course_id": data["question"].course_id,
              "student_ids": [data["student"].id], "action": "add"},
    )
    assert response.status_code == 403


@pytest.mark.parametrize("student_ids", [[True], ["1"], [-1], [1, 1]])
def test_invalid_student_ids_rejected(client, data, student_ids):
    assert propose(client, data, student_ids=student_ids).status_code == 400


def test_cancel_stale_request_does_not_require_target_student_active(client, db_session, data):
    change = propose(client, data).json()["data"]
    data["student"].status = "banned"
    db_session.commit()
    response = client.post(f"/api/class-changes/{change['request_id']}/cancel",
                           headers=requests.auth(data["admin"], service=False))
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "cancelled"
