"""持久等待仅消费真实治理结果，不重放处置。"""
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import test_approval_requests as requests
from test_approval_requests import ROOT, auth, request_body, resolve, submit


@pytest.fixture
def setup(db_session):
    return requests.setup.__wrapped__(db_session)


def test_wait_returns_immediately_and_resume_is_idempotent(client, db_session, setup):
    body = request_body(client, setup)
    case = submit(client, setup, body).json()["data"]
    path = f"{ROOT}/governance-requests/{body['request_id']}"
    response = client.get(path, headers=auth(setup["admin"]))
    assert response.status_code == 200
    assert response.json()["data"]["state"] == "waiting"
    assert client.post(path + "/resume", headers=auth(setup["admin"])).status_code == 409
    assert resolve(client, setup, case["case_id"]).status_code == 200
    first = client.post(path + "/resume", headers=auth(setup["admin"]))
    assert first.status_code == 200
    assert first.json()["data"]["state"] == "completed"
    assert first.json()["data"]["executed"] is True
    second = client.post(path + "/resume", headers=auth(setup["admin"]))
    assert second.json()["data"] == first.json()["data"]


def test_wait_owner_and_credentials(client, db_session, setup):
    body = request_body(client, setup)
    submit(client, setup, body)
    path = f"{ROOT}/governance-requests/{body['request_id']}"
    for method in [client.get, lambda p, **kw: client.post(p + "/resume", **kw),
                   lambda p, **kw: client.post(p + "/cancel", **kw)]:
        assert method(path, headers=auth(setup["other"])).status_code == 404
        assert method(path, headers=auth(setup["student"])).status_code == 403
        assert method(path, headers=auth(setup["admin"], service=False)).status_code == 401


def test_cancel_is_terminal_even_if_case_later_executes(client, setup):
    body = request_body(client, setup)
    case = submit(client, setup, body).json()["data"]
    path = f"{ROOT}/governance-requests/{body['request_id']}"
    cancelled = client.post(path + "/cancel", headers=auth(setup["admin"]))
    assert cancelled.status_code == 200
    assert cancelled.json()["data"]["state"] == "cancelled"
    assert resolve(client, setup, case["case_id"]).status_code == 200
    resumed = client.post(path + "/resume", headers=auth(setup["admin"]))
    assert resumed.json()["data"]["state"] == "cancelled"


def test_rejection_ends_wait(client, setup):
    body = request_body(client, setup)
    case = submit(client, setup, body).json()["data"]
    assert resolve(client, setup, case["case_id"], "skip").status_code == 200
    response = client.post(f"{ROOT}/governance-requests/{body['request_id']}/resume",
                           headers=auth(setup["admin"]))
    assert response.json()["data"]["state"] == "rejected"
    assert response.json()["data"]["executed"] is False


def test_expired_wait_does_not_replay_or_undo_case(client, db_session, setup):
    from app.modules.governance.models import ApprovalWait

    body = request_body(client, setup)
    submit(client, setup, body)
    wait = db_session.get(ApprovalWait, body["request_id"])
    wait.expires_at = datetime.now() - timedelta(days=1)
    db_session.commit()
    response = client.post(f"{ROOT}/governance-requests/{body['request_id']}/resume",
                           headers=auth(setup["admin"]))
    assert response.json()["data"]["state"] == "expired"


@pytest.mark.parametrize("operation", ["read", "resume", "cancel"])
@pytest.mark.parametrize("credential", ["no_user", "wrong_user", "wrong_service"])
def test_wait_requires_both_valid_credentials(client, setup, operation, credential):
    body = request_body(client, setup)
    submit(client, setup, body)
    headers = auth(setup["admin"])
    if credential == "no_user":
        headers.pop("Authorization")
    elif credential == "wrong_user":
        headers["Authorization"] = "Bearer invalid-test-credential"
    else:
        headers["X-Service-Token"] = "invalid-service-credential"
    path = f"{ROOT}/governance-requests/{body['request_id']}"
    response = client.get(path, headers=headers) if operation == "read" else client.post(
        f"{path}/{operation}", headers=headers,
    )
    assert response.status_code == 401


@pytest.mark.parametrize("change", ["role", "status"])
def test_wait_rechecks_current_admin_after_submission(client, db_session, setup, change):
    body = request_body(client, setup)
    submit(client, setup, body)
    headers = auth(setup["admin"])
    setattr(setup["admin"], change, "student" if change == "role" else "banned")
    db_session.commit()
    path = f"{ROOT}/governance-requests/{body['request_id']}"
    assert client.get(path, headers=headers).status_code == 403
    assert client.post(path + "/resume", headers=headers).status_code == 403
    assert client.post(path + "/cancel", headers=headers).status_code == 403


def test_wait_default_deadline_is_seven_days_and_retry_does_not_extend(client, setup):
    body = request_body(client, setup)
    before = datetime.now(UTC)
    submit(client, setup, body)
    path = f"{ROOT}/governance-requests/{body['request_id']}"
    first = client.get(path, headers=auth(setup["admin"])).json()["data"]
    deadline = datetime.fromisoformat(first["expires_at"]).replace(tzinfo=UTC)
    assert timedelta(days=7) <= deadline - before < timedelta(days=7, minutes=1)
    submit(client, setup, body)
    second = client.get(path, headers=auth(setup["admin"])).json()["data"]
    assert second["expires_at"] == first["expires_at"]


def test_expired_wait_does_not_undo_already_executed_governance(client, db_session, setup):
    from app.modules.governance.models import ApprovalWait
    from app.modules.qa.models import Question

    body = request_body(client, setup)
    case = submit(client, setup, body).json()["data"]
    assert resolve(client, setup, case["case_id"]).status_code == 200
    wait = db_session.get(ApprovalWait, body["request_id"])
    wait.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
    db_session.commit()
    path = f"{ROOT}/governance-requests/{body['request_id']}"
    expired = client.get(path, headers=auth(setup["admin"])).json()["data"]
    assert expired["state"] == "expired"
    assert expired["executed"] is True
    assert client.post(path + "/resume", headers=auth(setup["admin"])).json()["data"] == expired
    db_session.expire_all()
    assert db_session.get(Question, setup["question"].id).is_hidden is True
    assert db_session.get(ApprovalWait, body["request_id"]).state == "expired"


def test_unknown_and_broken_wait_links_are_rejected(client, db_session, setup):
    from app.modules.governance.models import ApprovalWait, ModerationCase

    missing = f"{ROOT}/governance-requests/{uuid4()}"
    assert client.get(missing, headers=auth(setup["admin"])).status_code == 404
    body = request_body(client, setup)
    case = submit(client, setup, body).json()["data"]
    db_session.get(ModerationCase, case["case_id"]).agent_run_id = "wrong-linked-run"
    db_session.commit()
    path = f"{ROOT}/governance-requests/{body['request_id']}"
    assert client.post(path + "/resume", headers=auth(setup["admin"])).status_code == 409
    assert db_session.get(ApprovalWait, body["request_id"]).state == "waiting"
