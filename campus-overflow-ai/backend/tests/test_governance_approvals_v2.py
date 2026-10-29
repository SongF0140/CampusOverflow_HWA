"""GL-01：批准只记录授权；任何旧入口都不能提前执行。"""

import hashlib
import json
from datetime import datetime, timedelta

import pytest
from sqlalchemy import text
from test_approval_requests import auth, request_body
from test_approval_requests import setup as setup  # noqa: F401

from app.core.config import settings

INTERNAL = "/internal/agent/user/governance-requests/v2"
PUBLIC = "/api/governance/approval-requests"


@pytest.fixture(autouse=True)
def enabled(monkeypatch):
    monkeypatch.setattr(settings, "governance_executor_enabled", True)


def create(client, setup, body=None):
    response = client.post(
        INTERNAL, json=body or request_body(client, setup), headers=auth(setup["admin"])
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def decide(client, setup, item, operation="approve", actor="admin", **extra):
    return client.post(
        f"{PUBLIC}/{item['request_id']}/{operation}",
        headers=auth(setup[actor], service=False),
        json={"args_hash": item["args_hash"], "note": "已核对冻结动作", **extra},
    )


def test_disabled_does_not_create_v2(client, setup, monkeypatch):
    monkeypatch.setattr(settings, "governance_executor_enabled", False)
    response = client.post(INTERNAL, json=request_body(client, setup), headers=auth(setup["admin"]))
    assert response.status_code == 503


def test_approve_only_queues_one_task_and_preserves_human_actor(client, db_session, setup):
    item = create(client, setup)
    assert item["status"] == "pending" and item["execution_id"] is None
    first = decide(client, setup, item, actor="other")
    assert first.status_code == 200, first.text
    data = first.json()["data"]
    assert data["status"] == "approved" and data["executed"] is False
    assert data["approved_by"] == setup["other"].id
    assert decide(client, setup, item).json()["data"]["execution_id"] == data["execution_id"]
    assert db_session.execute(text("SELECT COUNT(*) FROM governance_execution_jobs")).scalar() == 1
    db_session.refresh(setup["question"])
    assert setup["question"].is_hidden is False
    assert (
        db_session.execute(
            text("SELECT status FROM moderation_cases WHERE id=:id"), {"id": item["case_id"]}
        ).scalar()
        == "pending"
    )


def test_repeated_create_is_bound_to_exact_request(client, setup):
    body = request_body(client, setup)
    first = create(client, setup, body)
    assert create(client, setup, body)["request_id"] == first["request_id"]
    body["reason"] = "替换审批原因"
    assert client.post(INTERNAL, json=body, headers=auth(setup["admin"])).status_code == 409


@pytest.mark.parametrize(
    "extra", [{"args_hash": "0" * 64}, {"action": "delete"}, {"role": "admin"}]
)
def test_approval_cannot_replace_frozen_call(client, setup, extra):
    item = create(client, setup)
    assert decide(client, setup, item, **extra).status_code in (400, 409)


def test_student_and_service_token_alone_cannot_approve(client, setup):
    item = create(client, setup)
    assert decide(client, setup, item, actor="student").status_code == 403
    response = client.post(
        f"{PUBLIC}/{item['request_id']}/approve",
        json={"args_hash": item["args_hash"], "note": "无登录"},
        headers={"X-Service-Token": settings.agent_service_token},
    )
    assert response.status_code == 401


def test_external_key_cannot_supply_human_approval(client, setup, monkeypatch):
    item = create(client, setup)
    key = "gl01-external-test-key"
    monkeypatch.setattr(
        settings,
        "external_agent_keys",
        json.dumps(
            [
                {
                    "key_hash": hashlib.sha256(key.encode()).hexdigest(),
                    "user_id": setup["admin"].id,
                    "enabled": True,
                },
            ]
        ),
    )
    response = client.post(
        f"{PUBLIC}/{item['request_id']}/approve",
        json={"args_hash": item["args_hash"], "note": "不能代批"},
        headers={"X-Service-Token": settings.agent_service_token, "X-External-Agent-Key": key},
    )
    assert response.status_code == 401


@pytest.mark.parametrize("change", ["target", "expiry", "requester"])
def test_stale_expired_or_revoked_request_never_queues(client, db_session, setup, change):
    item = create(client, setup)
    if change == "target":
        setup["question"].body = "审批之前正文被修改"
    elif change == "expiry":
        db_session.execute(
            text("UPDATE governance_approval_requests SET expires_at=:at"),
            {"at": datetime.now() - timedelta(days=1)},
        )
    else:
        setup["admin"].role = "student"
    db_session.commit()
    assert decide(client, setup, item, actor="other").status_code in (403, 409)
    assert db_session.execute(text("SELECT COUNT(*) FROM governance_execution_jobs")).scalar() == 0
    if change == "expiry":
        assert (
            db_session.execute(
                text("SELECT status FROM moderation_cases WHERE id=:id"), {"id": item["case_id"]}
            ).scalar()
            == "rejected"
        )


def test_reject_is_terminal_without_execution(client, db_session, setup):
    item = create(client, setup)
    response = decide(client, setup, item, "reject")
    assert response.status_code == 200 and response.json()["data"]["status"] == "rejected"
    assert decide(client, setup, item).status_code == 409
    assert db_session.execute(text("SELECT COUNT(*) FROM governance_execution_jobs")).scalar() == 0


@pytest.mark.parametrize("operation", ["hide", "skip"])
def test_legacy_resolve_cannot_handle_v2(client, setup, operation):
    item = create(client, setup)
    response = client.post(
        f"/api/governance/moderation/cases/{item['case_id']}/resolve",
        headers=auth(setup["admin"], service=False),
        json={"decision": operation, "manager_feedback": "不能绕过新通道"},
    )
    assert response.status_code == 409


def test_request_requires_both_credentials(client, setup):
    response = client.post(
        INTERNAL, json=request_body(client, setup), headers=auth(setup["admin"], service=False)
    )
    assert response.status_code == 401


def test_old_internal_skip_cannot_mutate_v2(client, db_session, setup):
    from app.modules.governance import domain, service_internal

    item = create(client, setup)
    with pytest.raises(domain.CaseTargetNotReadyError):
        service_internal.update_case_agent_decision(
            db_session,
            item["case_id"],
            "不能通过旧内部接口跳过",
            "skip",
            caller_is_admin=False,
            principal_id=None,
            trace_id="old-internal",
        )


def test_rejected_request_closes_case_without_governance(client, db_session, setup):
    item = create(client, setup)
    assert decide(client, setup, item, "reject").status_code == 200
    assert (
        db_session.execute(
            text("SELECT status FROM moderation_cases WHERE id=:id"), {"id": item["case_id"]}
        ).scalar()
        == "rejected"
    )


def test_corrupt_case_snapshot_is_a_conflict(client, db_session, setup):
    item = create(client, setup)
    db_session.execute(
        text("UPDATE moderation_cases SET snapshot='not-json' WHERE id=:id"),
        {"id": item["case_id"]},
    )
    db_session.commit()
    response = decide(client, setup, item)
    assert response.status_code == 409


@pytest.mark.parametrize("revoke", [False, True])
def test_platform_source_is_bound_and_checked_at_approval(client, setup, monkeypatch, revoke):
    key = "v2-platform-source-key"
    mapping = {
        "key_hash": hashlib.sha256(key.encode()).hexdigest(),
        "user_id": setup["admin"].id,
        "enabled": True,
    }
    monkeypatch.setattr(settings, "external_agent_keys", json.dumps([mapping]))
    response = client.post(
        INTERNAL,
        json=request_body(client, setup),
        headers={
            "X-External-Agent-Key": key,
            "X-Service-Token": settings.agent_service_token,
        },
    )
    assert response.status_code == 200
    item = response.json()["data"]
    assert item["source_kind"] == "platform"
    assert "source_key_hash" not in item and key not in response.text
    if revoke:
        monkeypatch.setattr(settings, "external_agent_keys", json.dumps([mapping, mapping]))
    assert decide(client, setup, item).status_code == (403 if revoke else 200)


def test_queue_failure_rolls_back_human_approval(client, db_session, setup, monkeypatch):
    from app.modules.governance import repository

    item = create(client, setup)
    original = repository.decide_governance_approval

    def fail_after_write(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("测试入队提交之前失败")

    monkeypatch.setattr(repository, "decide_governance_approval", fail_after_write)
    with pytest.raises(RuntimeError, match="测试入队"):
        decide(client, setup, item)
    saved = client.get(
        f"{PUBLIC}/{item['request_id']}", headers=auth(setup["admin"], service=False)
    ).json()["data"]
    assert saved["status"] == "pending" and saved["execution_id"] is None
    assert db_session.execute(text("SELECT COUNT(*) FROM governance_execution_jobs")).scalar() == 0
