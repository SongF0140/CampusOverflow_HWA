"""AP-02B：版本化预览、冻结动作、事务去重与现有治理执行入口。"""

import json
import secrets
from datetime import datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.courses.models import Course
from app.modules.governance import service_approvals, service_notify
from app.modules.governance.models import AgentRun, ModerationCase
from app.modules.identity.models import User
from app.modules.interaction.models import Notification
from app.modules.qa.models import Question

ROOT = "/internal/agent/user"


@pytest.fixture
def setup(db_session: Session) -> dict:
    users = {}
    for name, role in [("admin", "admin"), ("other", "admin"), ("student", "student")]:
        user = User(username=f"request_{name}", email=f"{name}@example.com",
                    role=role, password_hash=secrets.token_hex(24))
        db_session.add(user)
        users[name] = user
    db_session.flush()
    course = Course(name="审批课程", code="APPROVAL", teacher_id=users["admin"].id)
    db_session.add(course)
    db_session.flush()
    question = Question(
        title="原题", body="原文", author_id=users["student"].id, course_id=course.id,
    )
    db_session.add(question)
    db_session.commit()
    return {**users, "question": question}


def auth(user: User, *, service: bool = True) -> dict:
    return {
        "Authorization": f"Bearer {create_access_token(user.id, user.role)}",
        **({"X-Service-Token": settings.agent_service_token} if service else {}),
        "X-Trace-Id": "approval-request-trace",
    }


def request_body(client: TestClient, setup: dict, *, kind: str = "question", action: str = "hide"):
    target = setup["student"] if kind == "user" else setup["question"]
    response = client.get(
        f"{ROOT}/governance-targets/{kind}/{target.id}/state?include_version=true",
        headers=auth(setup["admin"]),
    )
    assert response.status_code == 200
    return {
        "request_id": str(uuid4()), "target_type": kind, "target_id": target.id,
        "action": action, "reason": "请人工复核",
        "expected_version": response.json()["data"]["state_version"],
    }


def submit(client: TestClient, setup: dict, body: dict):
    return client.post(f"{ROOT}/governance-requests", json=body, headers=auth(setup["admin"]))


def resolve(client: TestClient, setup: dict, case_id: int, action: str = "hide", **extra):
    return client.post(
        f"/api/governance/moderation/cases/{case_id}/resolve",
        json={"decision": action, "manager_feedback": "核查后确认", **extra},
        headers=auth(setup["admin"], service=False),
    )


def test_request_persists_frozen_case_and_deduplicates(client, db_session, setup):
    body = request_body(client, setup)
    first = submit(client, setup, body)
    assert first.status_code == 200
    data = first.json()["data"]
    assert data["status"] == "pending"
    assert data["repeat"] is False
    case = db_session.get(ModerationCase, data["case_id"])
    snapshot = json.loads(case.snapshot)
    assert snapshot["action"] == "hide"
    assert snapshot["expected_version"] == body["expected_version"]
    assert snapshot["requester_id"] == setup["admin"].id
    assert case.trace_id == "approval-request-trace"
    assert case.agent_run_id == data["agent_run_id"]
    assert db_session.query(AgentRun).count() == 1
    assert db_session.query(Notification).count() == 2
    second = submit(client, setup, body)
    assert second.status_code == 200
    assert second.json()["data"]["case_id"] == case.id
    assert second.json()["data"]["repeat"] is True
    assert db_session.query(ModerationCase).count() == 1
    assert db_session.query(Notification).count() == 2
    db_session.refresh(setup["question"])
    assert setup["question"].is_hidden is False


@pytest.mark.parametrize("patch", [{"action": "delete"}, {"reason": "改原因"}])
def test_reused_key_cannot_replace_request(client, setup, patch):
    body = request_body(client, setup)
    assert submit(client, setup, body).status_code == 200
    assert submit(client, setup, {**body, **patch}).status_code == 409


def test_key_cannot_be_reused_by_other_admin(client, setup):
    body = request_body(client, setup)
    assert submit(client, setup, body).status_code == 200
    response = client.post(f"{ROOT}/governance-requests", json=body, headers=auth(setup["other"]))
    assert response.status_code == 409


@pytest.mark.parametrize("phase", ["submit", "execute"])
@pytest.mark.parametrize("change", ["body", "hidden", "deleted"])
def test_stale_target_cannot_submit_or_execute(client, db_session, setup, phase, change):
    body = request_body(client, setup)
    case_id = submit(client, setup, body).json()["data"]["case_id"] if phase == "execute" else None
    target = setup["question"]
    if change == "body":
        target.body = "确认前正文已改变"
    elif change == "hidden":
        target.is_hidden = True
    else:
        target.deleted_at = datetime(2026, 1, 1)
    db_session.commit()
    response = submit(client, setup, body) if phase == "submit" else resolve(client, setup, case_id)
    assert response.status_code == 409
    if case_id is not None:
        db_session.expire_all()
        assert db_session.get(ModerationCase, case_id).status == "pending"


def test_different_action_cannot_execute_frozen_request(client, db_session, setup):
    case_id = submit(client, setup, request_body(client, setup)).json()["data"]["case_id"]
    assert resolve(client, setup, case_id, "delete").status_code == 409
    db_session.refresh(setup["question"])
    assert setup["question"].deleted_at is None


def test_duration_is_frozen(client, db_session, setup):
    body = {**request_body(client, setup, kind="user", action="ban_temp"), "duration_days": 3}
    case_id = submit(client, setup, body).json()["data"]["case_id"]
    assert resolve(client, setup, case_id, "ban_temp", duration_days=4).status_code == 409
    db_session.refresh(setup["student"])
    assert setup["student"].status == "active"
    assert resolve(client, setup, case_id, "ban_temp", duration_days=3).status_code == 200


def test_valid_request_executes_once_and_retry_only_reads_result(client, db_session, setup):
    body = request_body(client, setup)
    case_id = submit(client, setup, body).json()["data"]["case_id"]
    assert resolve(client, setup, case_id).status_code == 200
    db_session.refresh(setup["question"])
    assert setup["question"].is_hidden
    assert resolve(client, setup, case_id).status_code != 200
    retry = submit(client, setup, body)
    assert retry.status_code == 200
    assert retry.json()["data"]["status"] == "executed"
    assert db_session.query(ModerationCase).count() == 1


def test_reject_does_not_require_unchanged_target(client, db_session, setup):
    case_id = submit(client, setup, request_body(client, setup)).json()["data"]["case_id"]
    setup["question"].body = "已更改"
    db_session.commit()
    response = resolve(client, setup, case_id, "skip")
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "rejected"


def test_corrupt_new_snapshot_fails_closed(client, db_session, setup):
    case_id = submit(client, setup, request_body(client, setup)).json()["data"]["case_id"]
    db_session.get(ModerationCase, case_id).snapshot = "{}"
    db_session.commit()
    assert resolve(client, setup, case_id).status_code == 409


def test_notification_failure_rolls_back_case_and_run(client, db_session, setup, monkeypatch):
    body = request_body(client, setup)

    def fail(*_args):
        raise RuntimeError("notification failure")

    monkeypatch.setattr(service_notify, "notify_case_created", fail)
    with pytest.raises(RuntimeError, match="notification failure"):
        submit(client, setup, body)
    db_session.expire_all()
    assert db_session.query(ModerationCase).count() == 0
    assert db_session.query(AgentRun).count() == 0


@pytest.mark.parametrize("bad", ["service", "user", "role"])
def test_request_requires_both_credentials_and_admin(client, setup, bad):
    body = {"request_id": str(uuid4()), "expected_version": "0" * 64,
            "target_type": "question", "target_id": 1, "action": "hide", "reason": "理由"}
    header = auth(setup["student"] if bad == "role" else setup["admin"])
    if bad == "service":
        del header["X-Service-Token"]
    if bad == "user":
        del header["Authorization"]
    response = client.post(f"{ROOT}/governance-requests", json=body, headers=header)
    assert response.status_code == (403 if bad == "role" else 401)


@pytest.mark.parametrize("patch", [
    {"action": "ban"}, {"expected_version": "bad"}, {"request_id": "bad"},
    {"role": "admin"}, {"duration_days": 3},
])
def test_invalid_request_rejected(client, setup, patch):
    body = request_body(client, setup)
    assert submit(client, setup, {**body, **patch}).status_code == 400


def test_version_is_stable_ignores_views_but_tracks_text(client, db_session, setup):
    before = request_body(client, setup)["expected_version"]
    setup["question"].view_count += 1
    db_session.commit()
    assert request_body(client, setup)["expected_version"] == before
    setup["question"].body = "新的内容"
    db_session.commit()
    assert request_body(client, setup)["expected_version"] != before


def test_unique_run_conflict_returns_existing_request(client, db_session, setup, monkeypatch):
    body = request_body(client, setup)
    case_id = submit(client, setup, body).json()["data"]["case_id"]
    original = service_approvals._existing_request
    calls = 0

    def miss_first(db, frozen):
        nonlocal calls
        calls += 1
        return None if calls == 1 else original(db, frozen)

    monkeypatch.setattr(service_approvals, "_existing_request", miss_first)
    response = submit(client, setup, body)
    assert response.status_code == 200
    assert response.json()["data"]["case_id"] == case_id
    assert response.json()["data"]["repeat"] is True
    assert calls == 2
    assert db_session.query(ModerationCase).count() == 1


def test_role_revoked_after_preview_cannot_submit(client, db_session, setup):
    body = request_body(client, setup)
    old_auth = auth(setup["admin"])
    setup["admin"].role = "student"
    db_session.commit()
    response = client.post(f"{ROOT}/governance-requests", json=body, headers=old_auth)
    assert response.status_code == 403
    assert db_session.query(ModerationCase).count() == 0
