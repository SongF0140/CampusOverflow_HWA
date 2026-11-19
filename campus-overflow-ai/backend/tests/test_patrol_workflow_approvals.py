"""系统来源逐次批准，不能被旧worker或任意目标替换。"""

import secrets
from uuid import uuid4

import pytest
from test_approval_requests import auth
from test_approval_requests import setup as setup  # noqa: F401

from app.core.config import settings

BASE = "/internal/agent/patrol/workflow-tasks"


@pytest.fixture
def ctx(client, setup, monkeypatch):
    monkeypatch.setattr(settings, "governance_workflow_enabled", True)
    monkeypatch.setattr(settings, "governance_executor_enabled", True)
    token = secrets.token_hex(24)
    monkeypatch.setattr(settings, "governance_executor_token", token)
    headers = {"X-Service-Token": settings.agent_service_token, "X-Trace-Id": "system-test"}
    root = client.post(
        BASE,
        headers=headers,
        json={
            "target_type": "question",
            "target_id": setup["question"].id,
        },
    ).json()["data"]
    return root, headers, {**headers, "X-Executor-Token": token}


def propose(client, ctx, **changes):
    root, headers, _ = ctx
    return client.post(
        f"{BASE}/{root['task_id']}/proposals",
        headers=headers,
        json={
            "request_id": str(uuid4()),
            "round": 1,
            "action": "hide",
            "reason": "请核实风险",
            "expected_version": root["initial_version"],
            "expected_content_version": root["initial_version"],
            **changes,
        },
    )


def approve(client, setup, item):
    return client.post(
        f"/api/governance/approval-requests/{item['request_id']}/approve",
        headers=auth(setup["admin"], service=False),
        json={"args_hash": item["args_hash"], "note": "核对后批准"},
    )


def test_system_author_action_is_derived_from_root(client, setup, ctx):
    root, headers, _ = ctx
    observation = client.get(f"{BASE}/{root['task_id']}/observe", headers=headers).json()["data"]
    result = propose(
        client, ctx, action="warn", expected_version=observation["author"]["state_version"]
    )
    assert result.status_code == 200
    call = result.json()["data"]["frozen_call"]
    assert (call["target_type"], call["target_id"]) == ("user", setup["student"].id)


def test_workflow_observation_has_full_redacted_title_body(client, db_session, setup, ctx):
    root, headers, _ = ctx
    setup["question"].title = "需要审核的标题"
    setup["question"].body = "普通内容" * 80 + "尾部风险 password=secret-value 联系13812345678"
    db_session.commit()
    value = client.get(f"{BASE}/{root['task_id']}/observe", headers=headers).json()["data"]
    assert value["title"] == "需要审核的标题" and "尾部风险" in value["body"]
    assert "secret-value" not in value["body"] and "13812345678" not in value["body"]
    assert value["content_complete"] is True
    setup["question"].body = "x" * 20001
    db_session.commit()
    value = client.get(f"{BASE}/{root['task_id']}/observe", headers=headers).json()["data"]
    assert value["content_complete"] is False


def test_author_proposal_cannot_refresh_context_version_silently(client, db_session, setup, ctx):
    root, headers, _ = ctx
    observed = client.get(f"{BASE}/{root['task_id']}/observe", headers=headers).json()["data"]
    setup["question"].body = "已经修改的业务内容"
    db_session.commit()
    response = propose(
        client, ctx, action="warn", expected_version=observed["author"]["state_version"]
    )
    assert response.status_code == 409


def test_approved_author_action_rechecks_content_context(client, db_session, setup, ctx):
    root, headers, executor = ctx
    observed = client.get(f"{BASE}/{root['task_id']}/observe", headers=headers).json()["data"]
    item = propose(
        client, ctx, action="warn", expected_version=observed["author"]["state_version"]
    ).json()["data"]
    assert approve(client, setup, item).status_code == 200
    claim = client.post(
        f"{BASE}/{root['task_id']}/proposals/{item['request_id']}/claim", headers=executor
    ).json()["data"]
    setup["question"].body = "批准之后内容再次改变"
    db_session.commit()
    response = client.post(
        f"/internal/agent/governance-executions/{claim['execution_id']}/execute",
        headers={**executor, "X-Execution-Lease": claim["lease"]},
        json={"lease_epoch": claim["lease_epoch"]},
    )
    assert response.status_code == 409


@pytest.mark.parametrize("failure", ["finished", "revoked", "audit"])
def test_system_execution_rechecks_root_admin_and_atomic_audit(
    client,
    db_session,
    setup,
    ctx,
    monkeypatch,
    failure,
):
    from sqlalchemy import text

    from app.modules.governance import repository

    root, headers, executor = ctx
    item = propose(client, ctx).json()["data"]
    assert approve(client, setup, item).status_code == 200
    claim = client.post(
        f"{BASE}/{root['task_id']}/proposals/{item['request_id']}/claim",
        headers=executor,
    ).json()["data"]
    if failure == "finished":
        client.post(
            f"{BASE}/{root['task_id']}/finish",
            headers=headers,
            json={"status": "needs_human", "reason": "cancelled"},
        )
    elif failure == "revoked":
        setup["admin"].role = "student"
        db_session.commit()
    else:

        def fail(*args, **kwargs):
            raise RuntimeError("required_audit_failure")

        monkeypatch.setattr(repository, "finish_governance_execution", fail)

    def execute():
        return client.post(
            f"/internal/agent/governance-executions/{claim['execution_id']}/execute",
            headers={**executor, "X-Execution-Lease": claim["lease"]},
            json={"lease_epoch": claim["lease_epoch"]},
        )

    if failure == "audit":
        with pytest.raises(RuntimeError, match="required_audit_failure"):
            execute()
    else:
        assert execute().status_code in {403, 409}
    db_session.refresh(setup["question"])
    assert setup["question"].is_hidden is False
    assert db_session.execute(text("SELECT result FROM governance_execution_jobs")).scalar() is None


def test_system_approval_and_targeted_claim_execute_once(client, setup, ctx):
    root, headers, executor = ctx
    response = propose(client, ctx)
    assert response.status_code == 200, response.text
    item = response.json()["data"]
    assert item["requester_id"] is None and item["source_kind"] == "system_patrol"
    assert item["frozen_call"]["workflow_task_id"] == root["task_id"]
    assert item["executed"] is False
    claim_url = f"{BASE}/{root['task_id']}/proposals/{item['request_id']}/claim"
    assert client.post(claim_url, headers=executor).json()["data"] is None
    approved = approve(client, setup, item)
    assert approved.status_code == 200, approved.text
    assert (
        client.post("/internal/agent/governance-executions/claim", headers=executor).json()["data"]
        is None
    )
    claim = client.post(claim_url, headers=executor).json()["data"]
    assert claim is not None
    execution_headers = {**executor, "X-Execution-Lease": claim["lease"]}
    url = f"/internal/agent/governance-executions/{claim['execution_id']}/execute"
    for _ in range(2):
        result = client.post(
            url, headers=execution_headers, json={"lease_epoch": claim["lease_epoch"]}
        )
        assert result.status_code == 200, result.text
        assert result.json()["data"]["executed"] is True
    read = client.get(f"{BASE}/{root['task_id']}/proposals/{item['request_id']}", headers=headers)
    assert read.json()["data"]["executed"] is True


@pytest.mark.parametrize("extra", [{"target_id": 999}, {"requester_id": 1}, {"round": 6}])
def test_no_target_identity_or_sixth_round_from_caller(client, setup, ctx, extra):
    assert propose(client, ctx, **extra).status_code == 400


def test_system_cannot_approve_itself(client, setup, ctx):
    item = propose(client, ctx).json()["data"]
    response = client.post(
        f"/api/governance/approval-requests/{item['request_id']}/approve",
        headers=ctx[1],
        json={"args_hash": item["args_hash"], "note": "伪造批准"},
    )
    assert response.status_code == 401


def test_repeat_bound_to_root_and_frozen_parameters(client, setup, ctx):
    request_id = str(uuid4())
    first = propose(client, ctx, request_id=request_id)
    assert first.status_code == 200
    assert (
        propose(client, ctx, request_id=request_id).json()["data"]["case_id"]
        == first.json()["data"]["case_id"]
    )
    assert propose(client, ctx, request_id=request_id, action="delete").status_code == 409


def test_closed_root_cannot_propose(client, setup, ctx):
    root, headers, _ = ctx
    result = client.post(
        f"{BASE}/{root['task_id']}/finish",
        headers=headers,
        json={"status": "needs_human", "reason": "round_limit"},
    )
    assert result.status_code == 200, result.text
    assert propose(client, ctx).status_code == 409
