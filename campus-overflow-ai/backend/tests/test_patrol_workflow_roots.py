"""系统根任务不借用管理员身份，也不产生实际处置。"""
import pytest
from sqlalchemy import text
from test_approval_requests import setup as setup  # noqa: F401

from app.core.config import settings

BASE = "/internal/agent/patrol/workflow-tasks"


@pytest.fixture
def headers(monkeypatch):
    monkeypatch.setitem(settings.__dict__, "governance_workflow_enabled", True)
    return {"X-Service-Token": settings.agent_service_token, "X-Trace-Id": "patrol-root-test"}


def create(client, setup, headers, **extra):
    return client.post(BASE, headers=headers, json={
        "target_type": "question", "target_id": setup["question"].id, **extra,
    })


def test_default_off(client, setup):
    response = create(client, setup, {"X-Service-Token": settings.agent_service_token})
    assert response.status_code == 503


@pytest.mark.parametrize("auth", [{}, {"X-Service-Token": "invalid"}])
def test_service_auth_required(client, setup, headers, auth):
    assert create(client, setup, auth).status_code == 401


def test_system_task_without_user_or_execution(client, setup, headers, db_session):
    response = create(client, setup, headers)
    assert response.status_code == 200, response.text
    item = response.json()["data"]
    assert item["source_kind"] == "system_patrol"
    assert item["target_id"] == setup["question"].id
    assert item["trace_id"] == "patrol-root-test"
    assert item["repeat"] is False
    run = db_session.execute(text(
        "SELECT user_id, task_type FROM agent_runs WHERE agent_run_id=:run"
    ), {"run": item["agent_run_id"]}).one()
    assert run == (None, "patrol_workflow")
    for table in ["moderation_cases", "governance_approval_requests", "governance_execution_jobs"]:
        assert db_session.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() == 0
    assert not db_session.get(type(setup["question"]), setup["question"].id).is_hidden
    fetched = client.get(f"{BASE}/{item['task_id']}", headers=headers).json()["data"]
    assert fetched["task_id"] == item["task_id"]


def test_same_version_reuses_root_even_with_other_trace(client, setup, headers, db_session):
    first = create(client, setup, headers).json()["data"]
    second = create(client, setup, {**headers, "X-Trace-Id": "retry"}).json()["data"]
    assert second["task_id"] == first["task_id"]
    assert second["trace_id"] == first["trace_id"]
    assert second["repeat"] is True
    assert db_session.execute(text("SELECT COUNT(*) FROM patrol_workflow_tasks")).scalar() == 1


def test_changed_body_is_a_new_content_version(client, setup, headers, db_session):
    first = create(client, setup, headers).json()["data"]
    setup["question"].body = "更新后正文"
    db_session.commit()
    second = create(client, setup, headers).json()["data"]
    assert second["task_id"] != first["task_id"]
    assert second["initial_version"] != first["initial_version"]


@pytest.mark.parametrize("state", ["hidden", "deleted", "missing"])
def test_unavailable_target_has_explicit_skip_reason(client, setup, headers, db_session, state):
    from datetime import datetime

    target_id = setup["question"].id
    if state == "hidden":
        setup["question"].is_hidden = True
    elif state == "deleted":
        setup["question"].deleted_at = datetime.now()
    else:
        target_id = 99999999
    db_session.commit()
    response = create(client, setup, headers, target_id=target_id)
    assert response.status_code == 409
    assert response.json()["reason_code"] == "patrol_target_unavailable"


def test_unknown_target_state_is_not_safe_to_skip(client, setup, headers, monkeypatch):
    from types import SimpleNamespace

    from app.modules.governance import service_approvals

    monkeypatch.setattr(
        service_approvals, "get_target_state",
        lambda *a, **kw: SimpleNamespace(current_state="conflict"),
    )
    response = create(client, setup, headers)
    assert response.status_code == 409
    assert "reason_code" not in response.json()


@pytest.mark.parametrize("extra", [{"requester_id": 1}, {"source_kind": "admin"},
                                   {"round": 1}, {"state_version": "fake"}, {"action": "delete"}])
def test_caller_cannot_supply_identity_budget_version_or_action(client, setup, headers, extra):
    assert create(client, setup, headers, **extra).status_code == 400


def test_user_target_is_not_a_patrol_content_root(client, setup, headers):
    assert create(client, setup, headers, target_type="user").status_code == 400


def test_hidden_or_missing_target_rejected(client, setup, headers, db_session):
    setup["question"].is_hidden = True
    db_session.commit()
    assert create(client, setup, headers).status_code == 409
    assert create(client, setup, headers, target_id=999999).status_code == 409


def test_creation_failure_rolls_back_audit(client, setup, headers, db_session, monkeypatch):
    from app.modules.governance import repository

    def fail(*args, **kwargs):
        raise RuntimeError("injected root write failure")

    monkeypatch.setattr(repository, "create_patrol_workflow_task", fail)
    with pytest.raises(RuntimeError):
        create(client, setup, headers)
    assert db_session.execute(text("SELECT COUNT(*) FROM agent_runs")).scalar() == 0


def test_unique_conflict_reads_original_and_rolls_back_extra_audit(
    client, setup, headers, db_session, monkeypatch,
):
    from app.modules.governance import repository

    first = create(client, setup, headers).json()["data"]
    original = repository.get_patrol_workflow_task
    reads = 0

    def initially_stale(*args, **kwargs):
        nonlocal reads
        reads += 1
        return None if reads == 1 else original(*args, **kwargs)

    monkeypatch.setattr(repository, "get_patrol_workflow_task", initially_stale)
    repeated = create(client, setup, headers).json()["data"]
    assert repeated["task_id"] == first["task_id"]
    assert repeated["repeat"] is True
    assert db_session.execute(text("SELECT COUNT(*) FROM agent_runs")).scalar() == 1
