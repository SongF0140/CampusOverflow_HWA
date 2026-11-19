"""GL-02：后端真实处置与回执原子提交，执行授权不来自模型。"""

import hashlib
import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from test_approval_requests import auth, request_body
from test_approval_requests import setup as setup  # noqa: F401
from test_governance_approvals_v2 import create, decide

from app.core.config import settings
from app.modules.governance import domain, service_execution_actions, service_notify

ROOT = "/internal/agent/governance-executions"
EXECUTOR = "gl02-dedicated-test-worker-token"
LEASE = "gl02-short-lived-test-lease"


@pytest.fixture(autouse=True)
def enabled(monkeypatch):
    monkeypatch.setattr(settings, "governance_executor_enabled", True)
    monkeypatch.setattr(settings, "governance_executor_token", EXECUTOR)


def execution_headers(lease=LEASE):
    return {
        "X-Service-Token": settings.agent_service_token,
        "X-Executor-Token": EXECUTOR,
        "X-Execution-Lease": lease,
        "X-Execution-Epoch": "1",
    }


def approved_job(client, db_session, setup, *, action="hide", kind="question"):
    item = create(client, setup, request_body(client, setup, action=action, kind=kind))
    response = decide(client, setup, item, actor="other")
    assert response.status_code == 200
    item = response.json()["data"]
    # GL-04负责生产租约派发，本测试只在隔离库模拟有效的领取记录。
    db_session.execute(
        text(
            "UPDATE governance_execution_jobs SET state='claimed', "
            "lease_hash=:digest, lease_epoch=1, lease_expires_at=:at "
            "WHERE execution_id=:id"
        ),
        {
            "digest": hashlib.sha256(LEASE.encode()).hexdigest(),
            "at": (datetime.now(UTC) + timedelta(minutes=5)).replace(tzinfo=None),
            "id": item["execution_id"],
        },
    )
    db_session.commit()
    return item


def execute(client, item, *, headers=None, **extra):
    return client.post(
        f"{ROOT}/{item['execution_id']}/execute",
        headers=headers if headers is not None else execution_headers(),
        json={"lease_epoch": 1, **extra},
    )


def test_service_or_human_credentials_cannot_execute(client, db_session, setup):
    item = approved_job(client, db_session, setup)
    for headers in ({"X-Service-Token": settings.agent_service_token}, auth(setup["admin"])):
        assert execute(client, item, headers=headers).status_code == 401


@pytest.mark.parametrize(
    "action,kind",
    [
        ("hide", "question"),
        ("delete", "question"),
        ("warn", "user"),
        ("ban", "user"),
        ("ban_temp", "user"),
    ],
)
def test_approved_action_executes_once_with_bound_receipt(client, db_session, setup, action, kind):
    item = approved_job(client, db_session, setup, action=action, kind=kind)
    first = execute(client, item)
    assert first.status_code == 200, first.text
    result = first.json()["data"]
    assert result["executed"] is True and result["action"] == action
    assert result["execution_id"] == item["execution_id"]
    assert result["approved_by"] == setup["other"].id
    again = execute(client, item)
    assert again.status_code == 200 and again.json()["data"] == result
    assert LEASE not in first.text and EXECUTOR not in first.text
    db_session.refresh(setup["question"])
    db_session.refresh(setup["student"])
    if action == "hide":
        assert setup["question"].is_hidden is True
    elif action == "delete":
        assert setup["question"].deleted_at is not None
    elif action == "warn":
        assert setup["student"].status == "active"
    else:
        assert setup["student"].status == "banned"
    case = db_session.execute(
        text("SELECT status,resolved_by FROM moderation_cases WHERE id=:id"),
        {"id": item["case_id"]},
    ).one()
    assert case.status == "executed" and case.resolved_by == setup["other"].id
    read = client.get(f"{ROOT}/{item['execution_id']}", headers=execution_headers())
    assert read.status_code == 200 and read.json()["data"]["receipt"] == result
    approval = client.get(
        f"/api/governance/approval-requests/{item['request_id']}",
        headers=auth(setup["other"], service=False),
    ).json()
    assert approval["data"]["status"] == "executed"
    assert "尚未执行" not in approval["message"]


@pytest.mark.parametrize("failure", ["lease", "epoch", "expiry"])
def test_invalid_lease_never_executes(client, db_session, setup, failure):
    item = approved_job(client, db_session, setup)
    headers = execution_headers("wrong" if failure == "lease" else LEASE)
    if failure == "expiry":
        db_session.execute(
            text("UPDATE governance_execution_jobs SET lease_expires_at=:at"),
            {"at": (datetime.now(UTC) - timedelta(seconds=1)).replace(tzinfo=None)},
        )
        db_session.commit()
    response = execute(client, item, headers=headers, lease_epoch=2 if failure == "epoch" else 1)
    assert response.status_code == 403
    db_session.refresh(setup["question"])
    assert setup["question"].is_hidden is False


@pytest.mark.parametrize("change", ["requester", "approver", "target", "expiry", "cancel"])
def test_authorization_is_rechecked_after_approval(client, db_session, setup, change):
    item = approved_job(client, db_session, setup)
    if change in {"requester", "approver"}:
        setup["admin" if change == "requester" else "other"].role = "student"
    elif change == "target":
        setup["question"].body = "已经更改的正文"
    elif change == "expiry":
        db_session.execute(
            text("UPDATE governance_approval_requests SET expires_at=:at"),
            {"at": (datetime.now(UTC) - timedelta(days=1)).replace(tzinfo=None)},
        )
    else:
        db_session.execute(text("UPDATE governance_approval_requests SET status='cancelled'"))
    db_session.commit()
    assert execute(client, item).status_code in (403, 409)
    db_session.refresh(setup["question"])
    assert setup["question"].is_hidden is False
    assert db_session.execute(text("SELECT result FROM governance_execution_jobs")).scalar() is None


def test_executor_cannot_supply_action_or_identity(client, db_session, setup):
    item = approved_job(client, db_session, setup)
    for extra in ({"action": "delete"}, {"operator_id": setup["admin"].id}):
        assert execute(client, item, **extra).status_code == 400


def test_execution_refreshes_cached_administrator_identity(client, db_session, setup):
    item = approved_job(client, db_session, setup)
    # 模拟认证阶段已加载管理员，随后数据库角色被撤销；ORM 缓存不能充当授权。
    assert setup["admin"].role == "admin"
    db_session.execute(
        text("UPDATE users SET role='student' WHERE id=:id"), {"id": setup["admin"].id}
    )
    db_session.commit()
    assert setup["admin"].role == "admin"
    with pytest.raises(domain.CaseActionForbiddenError):
        service_execution_actions.execute(db_session, item["execution_id"], LEASE, 1)
    db_session.refresh(setup["question"])
    assert setup["question"].is_hidden is False


def test_notification_failure_rolls_back_all_effects(client, db_session, setup, monkeypatch):
    item = approved_job(client, db_session, setup)
    original = service_notify.notify_case_resolved

    def fail(*args, **kwargs):
        raise RuntimeError("模拟处置通知故障")

    monkeypatch.setattr(service_notify, "notify_case_resolved", fail)
    with pytest.raises(RuntimeError, match="处置通知"):
        execute(client, item)
    db_session.refresh(setup["question"])
    assert setup["question"].is_hidden is False
    assert db_session.execute(text("SELECT result FROM governance_execution_jobs")).scalar() is None
    assert (
        db_session.execute(text("SELECT status FROM governance_approval_requests")).scalar()
        == "approved"
    )
    monkeypatch.setattr(service_notify, "notify_case_resolved", original)
    assert execute(client, item).status_code == 200


def test_platform_revocation_blocks_execution(client, db_session, setup, monkeypatch):
    key = "gl02-platform-key"
    mapping = {
        "key_hash": hashlib.sha256(key.encode()).hexdigest(),
        "user_id": setup["admin"].id,
        "enabled": True,
    }
    monkeypatch.setattr(settings, "external_agent_keys", json.dumps([mapping]))
    body = request_body(client, setup)
    response = client.post(
        "/internal/agent/user/governance-requests/v2",
        json=body,
        headers={
            "X-Service-Token": settings.agent_service_token,
            "X-External-Agent-Key": key,
        },
    )
    item = decide(client, setup, response.json()["data"], actor="other").json()["data"]
    db_session.execute(
        text(
            "UPDATE governance_execution_jobs SET state='claimed', lease_epoch=1, "
            "lease_hash=:digest, lease_expires_at=:at"
        ),
        {
            "digest": hashlib.sha256(LEASE.encode()).hexdigest(),
            "at": (datetime.now(UTC) + timedelta(minutes=5)).replace(tzinfo=None),
        },
    )
    db_session.commit()
    monkeypatch.setattr(settings, "external_agent_keys", "[]")
    assert execute(client, item).status_code == 403


@pytest.mark.parametrize("phase", ["audit_before", "receipt"])
def test_audit_or_receipt_failure_does_not_leave_partial_execution(
    client,
    db_session,
    setup,
    monkeypatch,
    phase,
):
    from app.modules.governance import repository

    item = approved_job(client, db_session, setup)
    method = "create_run" if phase == "audit_before" else "finish_governance_execution"
    original = getattr(repository, method)

    def fail(*args, **kwargs):
        if phase == "receipt":
            original(*args, **kwargs)
        raise RuntimeError("模拟必需审计或回执故障")

    monkeypatch.setattr(repository, method, fail)
    with pytest.raises(RuntimeError, match="回执故障"):
        execute(client, item)
    db_session.refresh(setup["question"])
    assert setup["question"].is_hidden is False
    assert db_session.execute(text("SELECT result FROM governance_execution_jobs")).scalar() is None
    assert db_session.execute(text("SELECT COUNT(*) FROM tool_call_logs")).scalar() == 0
    monkeypatch.setattr(repository, method, original)
    assert execute(client, item).status_code == 200


def test_response_replay_does_not_duplicate_notifications_or_audit(client, db_session, setup):
    item = approved_job(client, db_session, setup)
    before = db_session.execute(text("SELECT COUNT(*) FROM notifications")).scalar()
    first = execute(client, item).json()["data"]
    # 模拟已经提交但调用方没有接收到响应，仍使用原执行标识重试。
    second = execute(client, item).json()["data"]
    assert second == first
    assert db_session.execute(text("SELECT COUNT(*) FROM notifications")).scalar() == before + 1
    assert db_session.execute(text("SELECT COUNT(*) FROM tool_call_logs")).scalar() == 1
    assert (
        db_session.execute(
            text("SELECT COUNT(*) FROM agent_runs WHERE task_type='governance_execute'")
        ).scalar()
        == 1
    )


def test_disabled_executor_can_read_but_cannot_start(client, db_session, setup, monkeypatch):
    item = approved_job(client, db_session, setup)
    monkeypatch.setattr(settings, "governance_executor_enabled", False)
    assert execute(client, item).status_code == 503
    read = client.get(f"{ROOT}/{item['execution_id']}", headers=execution_headers())
    assert read.status_code == 200 and read.json()["data"]["executed"] is False


@pytest.mark.parametrize("configured", ["", settings.agent_service_token])
def test_executor_token_must_be_separate(client, db_session, setup, monkeypatch, configured):
    item = approved_job(client, db_session, setup)
    monkeypatch.setattr(settings, "governance_executor_token", configured)
    headers = execution_headers()
    headers["X-Executor-Token"] = configured
    assert execute(client, item, headers=headers).status_code == 401


def test_valid_lease_cannot_be_used_for_another_task(client, db_session, setup):
    approved_job(client, db_session, setup)
    other = approved_job(client, db_session, setup)
    db_session.execute(
        text("UPDATE governance_execution_jobs SET lease_hash=:digest WHERE execution_id=:id"),
        {"digest": hashlib.sha256(b"another-task-lease").hexdigest(), "id": other["execution_id"]},
    )
    db_session.commit()
    assert execute(client, other).status_code == 403
