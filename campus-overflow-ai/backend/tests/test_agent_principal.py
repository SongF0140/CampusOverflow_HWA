"""G-01：Agent 身份解析须同时验证服务和用户，不信任自报身份。"""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import get_current_user
from app.core.security import create_access_token
from app.main import app
from app.modules.identity.models import User

ENDPOINT = "/internal/agent/principal"
SERVICE_TOKEN = "agent-principal-test-service"


@pytest.fixture(autouse=True)
def configure_service_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "agent_service_token", SERVICE_TOKEN)


def create_user(db: Session, role: str = "student", **fields) -> User:
    user = User(
        username="principal_user", email="private@example.com",
        password_hash="private-password-hash", role=role, **fields,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def credentials(user: User) -> dict[str, str]:
    return {
        "X-Service-Token": SERVICE_TOKEN,
        "Authorization": f"Bearer {create_access_token(user.id, user.role)}",
    }


@pytest.mark.parametrize("role", ["student", "teacher", "admin"])
def test_returns_only_current_principal_fields(
    client: TestClient, db_session: Session, role: str,
) -> None:
    user = create_user(db_session, role)
    headers = {**credentials(user), "X-Trace-Id": "trace-principal-001"}

    response = client.get(ENDPOINT, headers=headers)

    assert response.status_code == 200
    assert response.json()["code"] == 200
    assert response.json()["data"] == {
        "user_id": user.id, "role": role, "status": "active",
        "identity_type": "undergraduate", "assistant_cert_status": "none",
    }
    assert response.headers["X-Trace-Id"] == "trace-principal-001"
    assert "private" not in response.text
    assert headers["Authorization"] not in response.text
    assert SERVICE_TOKEN not in response.text


@pytest.mark.parametrize(
    ("service", "user_token"),
    [(None, False), (None, True), ("wrong", True), (SERVICE_TOKEN, False)],
)
def test_both_credentials_are_required(
    client: TestClient, db_session: Session, service: str | None, user_token: bool,
) -> None:
    user = create_user(db_session)
    headers = credentials(user) if user_token else {}
    headers.pop("X-Service-Token", None)
    if service is not None:
        headers["X-Service-Token"] = service

    response = client.get(ENDPOINT, headers=headers)

    assert response.status_code == 401
    assert response.json()["data"] is None


@pytest.mark.parametrize("kind", ["invalid", "expired", "wrong-signature", "non-numeric"])
def test_invalid_user_credential_never_falls_back_to_service_identity(
    client: TestClient, db_session: Session, kind: str,
) -> None:
    user = create_user(db_session)
    payload = {
        "sub": str(user.id), "role": "admin",
        "exp": datetime.now(UTC) + timedelta(hours=1),
    }
    if kind == "expired":
        payload["exp"] = datetime.now(UTC) - timedelta(hours=1)
    if kind == "non-numeric":
        payload["sub"] = "not-an-id"
    key = "wrong-signing-key-for-principal-test-only" if kind == "wrong-signature" else (
        settings.jwt_secret
    )
    token = "not-a-jwt" if kind == "invalid" else jwt.encode(
        payload, key, algorithm=settings.jwt_algorithm,
    )

    response = client.get(ENDPOINT, headers={
        "X-Service-Token": SERVICE_TOKEN, "Authorization": f"Bearer {token}",
    })

    assert response.status_code == 401
    assert response.json()["data"] is None


def test_role_and_assistant_fields_come_from_database(
    client: TestClient, db_session: Session,
) -> None:
    user = create_user(db_session, "admin")
    headers = credentials(user)
    user.role = "student"
    user.identity_type = "postgraduate"
    user.assistant_cert_status = "approved"
    db_session.commit()

    response = client.get(ENDPOINT, headers=headers)

    assert response.status_code == 200
    assert response.json()["data"] == {
        "user_id": user.id, "role": "student", "status": "active",
        "identity_type": "postgraduate", "assistant_cert_status": "approved",
    }


def test_banning_after_token_issue_rejects_existing_token(
    client: TestClient, db_session: Session,
) -> None:
    user = create_user(db_session)
    headers = credentials(user)
    user.status = "banned"
    db_session.commit()

    response = client.get(ENDPOINT, headers=headers)

    assert response.status_code == 403
    assert response.json()["data"] is None


def test_deleted_user_is_rejected(client: TestClient, db_session: Session) -> None:
    user = create_user(db_session)
    headers = credentials(user)
    db_session.delete(user)
    db_session.commit()

    response = client.get(ENDPOINT, headers=headers)

    assert response.status_code == 401
    assert response.json()["data"] is None


def test_query_and_headers_cannot_override_authenticated_identity(
    client: TestClient, db_session: Session,
) -> None:
    user = create_user(db_session)
    response = client.get(
        ENDPOINT, params={"user_id": 999, "role": "admin"},
        headers={**credentials(user), "X-User-Id": "999", "X-Role": "admin"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["user_id"] == user.id
    assert response.json()["data"]["role"] == "student"
    assert response.headers["X-Trace-Id"].strip()


def test_unconfigured_service_token_cannot_authenticate(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = create_user(db_session)
    monkeypatch.setattr(settings, "agent_service_token", "")

    response = client.get(ENDPOINT, headers={
        "X-Service-Token": "", "Authorization": credentials(user)["Authorization"],
    })

    assert response.status_code == 401


def test_openapi_declares_success_envelope_and_minimal_principal(client: TestClient) -> None:
    document = client.get("/openapi.json").json()
    success = document["paths"][ENDPOINT]["get"]["responses"]["200"]
    reference = success["content"]["application/json"]["schema"]["$ref"]
    schemas = document["components"]["schemas"]
    envelope = schemas[reference.rsplit("/", 1)[-1]]

    assert set(envelope["properties"]) == {"code", "data", "message"}
    assert envelope["properties"]["code"]["const"] == 200
    principal_ref = envelope["properties"]["data"]["$ref"]
    principal = schemas[principal_ref.rsplit("/", 1)[-1]]
    fields = {"user_id", "role", "status", "identity_type", "assistant_cert_status"}
    assert set(principal["properties"]) == fields
    assert set(principal["required"]) == fields


@pytest.mark.parametrize("service", [None, "wrong"])
def test_invalid_service_short_circuits_user_resolution(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, service: str | None,
) -> None:
    def forbidden_user_resolution():
        pytest.fail("服务校验失败后不得解析用户身份")

    monkeypatch.setitem(app.dependency_overrides, get_current_user, forbidden_user_resolution)
    headers = {"Authorization": "Bearer must-not-be-resolved"}
    if service is not None:
        headers["X-Service-Token"] = service

    response = client.get(ENDPOINT, headers=headers)

    assert response.status_code == 401
    assert response.json()["data"] is None
