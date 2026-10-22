"""G-04-A：双凭证运行归属、写入边界及摘要保护。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.governance.models import AgentRun, ToolCallLog
from app.modules.identity.models import User

SERVICE = {"X-Service-Token": settings.agent_service_token}


@pytest.fixture
def actors(db_session: Session) -> list[User]:
    users = [
        User(
            username=f"audit_{role}", email=f"{role}@audit.test", password_hash="unused", role=role
        )
        for role in ("student", "teacher", "admin")
    ]
    db_session.add_all(users)
    db_session.commit()
    return users


def auth(user: User, trace: str = "run-trace") -> dict[str, str]:
    return {
        **SERVICE,
        "Authorization": f"Bearer {create_access_token(user.id, user.role)}",
        "X-Trace-Id": trace,
    }


def create_run(client: TestClient, headers: dict, run_id: str = "owned-run", **extra):
    return client.post(
        "/internal/agent/user/runs",
        headers=headers,
        json={
            "agent_run_id": run_id,
            "task_type": "chat",
            "input_summary": "知识问答",
            **extra,
        },
    )


@pytest.mark.parametrize("role_index", [0, 1, 2])
def test_user_run_uses_database_identity_and_header_trace(
    client: TestClient,
    db_session: Session,
    actors: list[User],
    role_index: int,
) -> None:
    actor = actors[role_index]
    response = create_run(client, auth(actor), user_id=999, role="admin", trace_id="forged")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["user_id"] == actor.id
    assert data["trace_id"] == "run-trace"
    row = db_session.query(AgentRun).one()
    assert row.user_id == actor.id
    assert row.status == "running"


@pytest.mark.parametrize("operation", ["create", "update", "tool"])
@pytest.mark.parametrize("missing", ["service", "user"])
def test_all_user_writes_require_both_credentials(
    client: TestClient,
    actors: list[User],
    operation: str,
    missing: str,
) -> None:
    headers = auth(actors[0])
    headers.pop("X-Service-Token" if missing == "service" else "Authorization")
    if operation == "create":
        response = create_run(client, headers)
    elif operation == "update":
        response = client.patch(
            "/internal/agent/user/runs/missing", headers=headers, json={"status": "failed"}
        )
    else:
        response = client.post(
            "/internal/agent/user/tool-calls",
            headers=headers,
            json={"agent_run_id": "missing", "tool_name": "fetchTags", "status": "succeeded"},
        )
    assert response.status_code == 401


@pytest.mark.parametrize("operation", ["create", "update", "tool"])
def test_banned_user_cannot_write_audit(
    client: TestClient,
    db_session: Session,
    actors: list[User],
    operation: str,
) -> None:
    actor = actors[0]
    headers = auth(actor)
    assert create_run(client, headers).status_code == 200
    actor.status = "banned"
    db_session.commit()
    if operation == "create":
        response = create_run(client, headers, "second")
    elif operation == "update":
        response = client.patch(
            "/internal/agent/user/runs/owned-run", headers=headers, json={"status": "failed"}
        )
    else:
        response = client.post(
            "/internal/agent/user/tool-calls",
            headers=headers,
            json={"agent_run_id": "owned-run", "tool_name": "fetchTags", "status": "failed"},
        )
    assert response.status_code == 403


@pytest.mark.parametrize("other_index", [1, 2])
def test_other_user_including_admin_cannot_update_or_attach_logs(
    client: TestClient,
    db_session: Session,
    actors: list[User],
    other_index: int,
) -> None:
    assert create_run(client, auth(actors[0])).status_code == 200
    headers = auth(actors[other_index])
    update = client.patch(
        "/internal/agent/user/runs/owned-run", headers=headers, json={"status": "succeeded"}
    )
    tool = client.post(
        "/internal/agent/user/tool-calls",
        headers=headers,
        json={"agent_run_id": "owned-run", "tool_name": "fetchTags", "status": "succeeded"},
    )
    assert update.status_code == tool.status_code == 404
    assert db_session.query(ToolCallLog).count() == 0
    assert db_session.query(AgentRun).one().status == "running"


def test_legacy_service_route_cannot_mutate_owned_run(
    client: TestClient,
    db_session: Session,
    actors: list[User],
) -> None:
    assert create_run(client, auth(actors[0])).status_code == 200
    update = client.patch(
        "/internal/agent/runs/owned-run", headers=SERVICE, json={"status": "failed"}
    )
    tool = client.post(
        "/internal/agent/tool-calls",
        headers=SERVICE,
        json={"agent_run_id": "owned-run", "tool_name": "fetchTags", "status": "success"},
    )
    assert update.status_code == tool.status_code == 404
    assert db_session.query(ToolCallLog).count() == 0


def test_user_cannot_claim_legacy_unowned_run(client: TestClient, actors: list[User]) -> None:
    assert (
        client.post(
            "/internal/agent/runs",
            headers=SERVICE,
            json={
                "task_type": "chat",
                "agent_run_id": "legacy-run",
                "input_summary": "旧运行",
            },
        ).status_code
        == 200
    )
    headers = auth(actors[0])
    assert (
        client.patch(
            "/internal/agent/user/runs/legacy-run", headers=headers, json={"status": "failed"}
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/internal/agent/user/tool-calls",
            headers=headers,
            json={
                "agent_run_id": "legacy-run",
                "tool_name": "fetchTags",
                "status": "failed",
            },
        ).status_code
        == 404
    )


def test_tool_trace_is_parent_run_trace_and_terminal_rejects_late_logs(
    client: TestClient,
    db_session: Session,
    actors: list[User],
) -> None:
    headers = auth(actors[0])
    assert create_run(client, headers).status_code == 200
    body = {"agent_run_id": "owned-run", "tool_name": "fetchTags", "status": "succeeded"}
    tool = client.post(
        "/internal/agent/user/tool-calls", headers=auth(actors[0], "other-trace"), json=body
    )
    assert tool.status_code == 200
    assert tool.json()["data"]["trace_id"] == "run-trace"
    assert (
        client.patch(
            "/internal/agent/user/runs/owned-run", headers=headers, json={"status": "succeeded"}
        ).status_code
        == 200
    )
    assert (
        client.post("/internal/agent/user/tool-calls", headers=headers, json=body).status_code
        == 400
    )
    assert (
        client.patch(
            "/internal/agent/user/runs/owned-run", headers=headers, json={"status": "failed"}
        ).status_code
        == 400
    )
    assert db_session.query(ToolCallLog).count() == 1


def test_duplicate_run_id_is_conflict_without_changing_owner(
    client: TestClient,
    db_session: Session,
    actors: list[User],
) -> None:
    assert create_run(client, auth(actors[0])).status_code == 200
    assert create_run(client, auth(actors[1])).status_code == 409
    assert db_session.query(AgentRun).one().user_id == actors[0].id


def test_summary_redacts_before_truncation_on_all_writes(
    client: TestClient,
    db_session: Session,
    actors: list[User],
) -> None:
    headers = auth(actors[0])
    sensitive = (
        '{"password":"pw-secret", "Authorization":"Bearer jwt-secret", '
        '"Cookie":"co_token=cookie-secret"} 密码=中文秘密 '
    )
    pem = "-----BEGIN PRIVATE KEY-----\n" + "PEMSECRET" * 100 + "\n-----END PRIVATE KEY-----"
    assert create_run(client, headers, input_summary=pem).status_code == 200
    response = client.post(
        "/internal/agent/user/tool-calls",
        headers=headers,
        json={
            "agent_run_id": "owned-run",
            "tool_name": "fetchTags",
            "status": "failed",
            "args_summary": sensitive,
            "result_summary": sensitive,
        },
    )
    assert response.status_code == 200
    assert (
        client.patch(
            "/internal/agent/user/runs/owned-run",
            headers=headers,
            json={
                "status": "failed",
                "output_summary": sensitive,
                "error_summary": sensitive + "x" * 500,
            },
        ).status_code
        == 200
    )
    run = db_session.query(AgentRun).one()
    tool = db_session.query(ToolCallLog).one()
    for summary in [
        run.input_summary,
        run.output_summary,
        run.error_summary,
        tool.args_summary,
        tool.result_summary,
    ]:
        assert len(summary) <= 200
        for secret in ["pw-secret", "jwt-secret", "cookie-secret", "PEMSECRET", "中文秘密"]:
            assert secret not in summary


def test_user_write_openapi_has_explicit_response_contract(client: TestClient) -> None:
    schemas = client.get("/openapi.json").json()
    for path, method in [
        ("/internal/agent/user/runs", "post"),
        ("/internal/agent/user/runs/{agent_run_id}", "patch"),
        ("/internal/agent/user/tool-calls", "post"),
    ]:
        schema = schemas["paths"][path][method]["responses"]["200"]["content"]["application/json"][
            "schema"
        ]
        assert "$ref" in schema
