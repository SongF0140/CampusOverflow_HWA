from datetime import UTC, datetime, timedelta

from test_approval_requests import setup as setup  # noqa: F401
from test_patrol_workflow_approvals import BASE  # noqa: F401
from test_patrol_workflow_approvals import ctx as ctx

from app.modules.qa.models import Question


def test_bound_failed_run_reconciles_only_matching_binding(client, ctx):
    root, headers, _ = ctx
    path = f"{BASE}/{root['task_id']}"
    assert (
        client.post(
            path + "/bind", headers=headers, json={"workflow_run_id": "wrun_winner"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            path + "/reconcile",
            headers=headers,
            json={"workflow_run_id": "wrun_other", "status": "failed"},
        ).status_code
        == 409
    )
    response = client.post(
        path + "/reconcile",
        headers=headers,
        json={"workflow_run_id": "wrun_winner", "status": "failed"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["stop_reason"] == "workflow_runtime_failed"


def test_expired_unbound_root_is_closed_before_dispatch(client, db_session, ctx):
    from sqlalchemy import text

    root, headers, _ = ctx
    db_session.execute(
        text("UPDATE patrol_workflow_tasks SET created_at=:t"),
        {"t": datetime.now(UTC).replace(tzinfo=None) - timedelta(days=8)},
    )
    db_session.commit()
    assert client.get(BASE, headers=headers).json()["data"]["items"] == []
    state = client.get(f"{BASE}/{root['task_id']}", headers=headers).json()["data"]
    assert state["status"] == "needs_human" and state["stop_reason"] == "approval_expired"


def test_scan_fixed_page_ack_and_historical_content(client, db_session, setup, ctx):
    _, headers, _ = ctx
    for index in range(105):
        db_session.add(
            Question(
                title=f"旧内容{index}",
                body="历史内容",
                author_id=setup["student"].id,
                course_id=setup["question"].course_id,
                created_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2),
            )
        )
    db_session.commit()
    path = BASE + "/scan/page"
    first = client.get(path, headers=headers).json()["data"]
    assert len(first["items"]) == 100
    # 未确认模拟失败/进程重启，重复读取必须仍是原页。
    assert client.get(path, headers=headers).json()["data"] == first
    assert (
        client.post(path, headers=headers, json={"revision": first["revision"] + 1}).status_code
        == 409
    )
    assert (
        client.post(path, headers=headers, json={"revision": first["revision"]}).status_code == 200
    )
    second = client.get(path, headers=headers).json()["data"]
    assert len(second["items"]) == 6 and not second["has_more"]
    assert not {i["target_id"] for i in first["items"]} & {i["target_id"] for i in second["items"]}
    assert (
        client.post(path, headers=headers, json={"revision": second["revision"]}).status_code == 200
    )
    assert len(client.get(path, headers=headers).json()["data"]["items"]) == 100


def test_root_recovery_paginates_more_than_one_hundred(client, db_session, setup, ctx):
    first_root, headers, _ = ctx
    expected = {first_root["task_id"]}
    for index in range(104):
        question = Question(
            title=f"分页{index}",
            body="待巡检内容",
            author_id=setup["student"].id,
            course_id=setup["question"].course_id,
        )
        db_session.add(question)
        db_session.commit()
        value = client.post(
            BASE, headers=headers, json={"target_type": "question", "target_id": question.id}
        )
        expected.add(value.json()["data"]["task_id"])
    first = client.get(BASE + "?scope=all", headers=headers).json()["data"]
    assert len(first["items"]) == 100 and first["next_cursor"]
    second = client.get(
        BASE + f"?scope=all&after_task_id={first['next_cursor']}", headers=headers
    ).json()["data"]
    assert len(second["items"]) == 5 and second["next_cursor"] is None
    assert {row["task_id"] for row in first["items"] + second["items"]} == expected
