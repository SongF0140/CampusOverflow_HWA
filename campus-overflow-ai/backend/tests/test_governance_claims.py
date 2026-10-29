from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from test_approval_requests import setup as setup  # noqa: F401
from test_governance_approvals_v2 import create, decide
from test_governance_execution import approved_job, execution_headers
from test_governance_execution import enabled as enabled  # noqa: F401

ROOT = "/internal/agent/governance-executions"


def claim(client):
    return client.post(f"{ROOT}/claim", json={}, headers=execution_headers())


def test_claim_requires_worker_and_never_claims_unapproved(client, setup):
    create(client, setup)
    assert claim(client).json()["data"] is None
    assert client.post(f"{ROOT}/claim", json={}).status_code == 401


def test_claim_rotates_lease_and_fences_old_worker(client, db_session, setup):
    item = create(client, setup)
    decide(client, setup, item)
    first = claim(client).json()["data"]
    assert first["lease_epoch"] == 1 and first["lease"]
    assert claim(client).json()["data"] is None
    db_session.execute(
        text("UPDATE governance_execution_jobs SET lease_expires_at=:at"),
        {"at": datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)},
    )
    db_session.commit()
    second = claim(client).json()["data"]
    assert second["lease_epoch"] == 2 and second["lease"] != first["lease"]
    headers = execution_headers(first["lease"])
    assert (
        client.post(
            f"{ROOT}/{first['execution_id']}/execute", headers=headers, json={"lease_epoch": 1}
        ).status_code
        == 403
    )


def test_report_never_invents_success_and_stops_unknown_retries(client, db_session, setup):
    item = approved_job(client, db_session, setup)
    path = f"{ROOT}/{item['execution_id']}/report"
    assert (
        client.post(
            path, headers=execution_headers(), json={"lease_epoch": 1, "outcome": "completed"}
        ).status_code
        == 409
    )
    assert (
        client.post(
            path, headers=execution_headers(), json={"lease_epoch": 1, "outcome": "result_unknown"}
        ).status_code
        == 200
    )
    assert claim(client).json()["data"] is None


def test_completed_receipt_can_be_reported_once(client, db_session, setup):
    item = approved_job(client, db_session, setup)
    headers = execution_headers()
    assert (
        client.post(
            f"{ROOT}/{item['execution_id']}/execute", headers=headers, json={"lease_epoch": 1}
        ).status_code
        == 200
    )
    for _ in range(2):
        assert (
            client.post(
                f"{ROOT}/{item['execution_id']}/report",
                headers=headers,
                json={"lease_epoch": 1, "outcome": "completed"},
            ).status_code
            == 200
        )
    assert claim(client).json()["data"] is None
