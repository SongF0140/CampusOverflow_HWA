"""追加计划/步骤记录必须遵守归属、顺序、预算及事务边界。"""

import pytest
from sqlalchemy import text

from app.modules.governance.models import ToolCallLog
from tests.test_agent_run_ownership import actors as actors
from tests.test_agent_run_ownership import auth, create_run


def event(client, headers, event_type="plan", revision=1, **fields):
    return client.post(
        "/internal/agent/user/runs/owned-run/events",
        headers=headers,
        json={"event_type": event_type, "plan_revision": revision, **fields},
    )


def plan_steps(count=1):
    return [{"step_id": f"s{i + 1}", "tool_name": "fetchTags"} for i in range(count)]


def test_plan_and_steps_append_and_finish_atomically(client, db_session, actors):
    headers = auth(actors[0])
    assert create_run(client, headers).status_code == 200
    assert event(client, headers, steps=plan_steps()).status_code == 200
    assert (
        event(client, headers, "step_started", step_id="s1", tool_name="fetchTags").status_code
        == 200
    )
    assert (
        client.patch(
            "/internal/agent/user/runs/owned-run", headers=headers, json={"status": "succeeded"}
        ).status_code
        == 400
    )
    response = event(
        client, headers, "step_succeeded", step_id="s1", tool_name="fetchTags", duration_ms=7
    )
    assert response.status_code == 200
    assert response.json()["data"]["sequence_no"] == 3
    assert response.json()["data"]["trace_id"] == "run-trace"
    log = db_session.query(ToolCallLog).one()
    assert log.status == "succeeded" and log.duration_ms == 7
    assert (
        client.patch(
            "/internal/agent/user/runs/owned-run", headers=headers, json={"status": "succeeded"}
        ).status_code
        == 200
    )
    assert event(client, headers, steps=[]).status_code == 400


@pytest.mark.parametrize("missing", ["service", "user"])
def test_event_needs_both_credentials(client, actors, missing):
    headers = auth(actors[0])
    headers.pop("X-Service-Token" if missing == "service" else "Authorization")
    assert event(client, headers, steps=[]).status_code == 401


def test_event_rejects_other_user_and_banned_owner(client, db_session, actors):
    headers = auth(actors[0])
    assert create_run(client, headers).status_code == 200
    assert event(client, auth(actors[2]), steps=[]).status_code == 404
    actors[0].status = "banned"
    db_session.commit()
    assert event(client, headers, steps=[]).status_code == 403


@pytest.mark.parametrize(
    "fields",
    [
        {"step_id": "s1", "tool_name": "fetchTags"},
        {"step_id": "s2", "tool_name": "searchQuestions"},
    ],
)
def test_step_cannot_start_without_matching_plan(client, actors, fields):
    headers = auth(actors[0])
    assert create_run(client, headers).status_code == 200
    assert event(client, headers, "step_started", **fields).status_code == 400
    assert event(client, headers, steps=plan_steps()).status_code == 200
    if fields["step_id"] != "s1":
        assert event(client, headers, "step_started", **fields).status_code == 400


def test_duplicate_out_of_order_and_unmatched_finish_rejected(client, db_session, actors):
    headers = auth(actors[0])
    assert create_run(client, headers).status_code == 200
    assert event(client, headers, steps=plan_steps(2)).status_code == 200
    assert (
        event(client, headers, "step_started", step_id="s2", tool_name="fetchTags").status_code
        == 400
    )
    step = {"step_id": "s1", "tool_name": "fetchTags"}
    assert event(client, headers, "step_succeeded", **step).status_code == 400
    assert event(client, headers, "step_started", **step).status_code == 200
    assert event(client, headers, "step_started", **step).status_code == 400
    assert event(client, headers, "step_failed", **step).status_code == 200
    assert event(client, headers, "step_failed", **step).status_code == 400
    assert db_session.query(ToolCallLog).count() == 1


def test_event_limit_cumulative_across_two_plans(client, db_session, actors):
    headers = auth(actors[0])
    assert create_run(client, headers).status_code == 200
    for revision, count in [(1, 8), (2, 5)]:
        assert event(client, headers, revision=revision, steps=plan_steps(count)).status_code == 200
        for i in range(count):
            fields = {"step_id": f"s{i + 1}", "tool_name": "fetchTags"}
            response = event(client, headers, "step_started", revision, **fields)
            if revision == 2 and i == 4:
                assert response.status_code == 400
            else:
                assert response.status_code == 200
                assert (
                    event(client, headers, "step_succeeded", revision, **fields).status_code == 200
                )
    assert db_session.query(ToolCallLog).count() == 12


@pytest.mark.parametrize("extra", [{"args": {"password": "secret"}}, {"objective": "原始隐私"}])
def test_event_contract_does_not_accept_raw_content(client, actors, extra):
    headers = auth(actors[0])
    assert create_run(client, headers).status_code == 200
    assert event(client, headers, steps=plan_steps(), **extra).status_code == 400


def test_plan_revision_and_step_schema_are_bounded(client, actors):
    headers = auth(actors[0])
    assert create_run(client, headers).status_code == 200
    assert event(client, headers, revision=2, steps=[]).status_code == 400
    assert event(client, headers, steps=plan_steps(9)).status_code == 400
    assert event(client, headers, steps=[plan_steps()[0]] * 2).status_code == 400
    assert (
        event(client, headers, steps=[{"step_id": "s1", "tool_name": "deleteAll"}]).status_code
        == 400
    )
    assert event(client, headers, steps=[]).status_code == 200
    assert event(client, headers, steps=[]).status_code == 400
    assert event(client, headers, revision=2, steps=[]).status_code == 200
    assert event(client, headers, revision=3, steps=[]).status_code == 400


def test_completion_and_tool_log_roll_back_together(client, db_session, actors, monkeypatch):
    from app.modules.governance import repository

    headers = auth(actors[0])
    assert create_run(client, headers).status_code == 200
    assert event(client, headers, steps=plan_steps()).status_code == 200
    assert (
        event(client, headers, "step_started", step_id="s1", tool_name="fetchTags").status_code
        == 200
    )

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("simulated log write failure")

    monkeypatch.setattr(repository, "create_tool_call", unavailable)
    with pytest.raises(RuntimeError, match="simulated"):
        event(client, headers, "step_succeeded", step_id="s1", tool_name="fetchTags")
    assert db_session.execute(text("SELECT count(*) FROM agent_run_events")).scalar_one() == 2
    assert db_session.query(ToolCallLog).count() == 0
