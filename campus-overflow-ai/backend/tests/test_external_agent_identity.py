"""外部密钥不能自报管理员；实时查后端管理员映射。"""
import hashlib
import json

import pytest
import test_approval_requests as requests

from app.core.config import settings


@pytest.fixture
def setup(db_session):
    return requests.setup.__wrapped__(db_session)


def configure(monkeypatch, setup):
    monkeypatch.setattr(settings, "external_agent_keys", json.dumps([{
        "key_hash": hashlib.sha256(b"external-fixture").hexdigest(),
        "user_id": setup["admin"].id, "enabled": True,
    }]), raising=False)
    return {"X-Service-Token": settings.agent_service_token,
            "X-External-Agent-Key": "external-fixture"}


def test_external_identity_is_backend_admin(client, setup, monkeypatch):
    headers = configure(monkeypatch, setup)
    result = client.get("/internal/agent/external/principal", headers=headers)
    assert result.status_code == 200
    assert result.json()["data"]["user_id"] == setup["admin"].id
    assert result.json()["data"]["role"] == "admin"
    assert "external-fixture" not in result.text
    path = f"/internal/agent/user/governance-targets/question/{setup['question'].id}/state"
    assert client.get(path, headers=headers).status_code == 200


def test_external_key_revocation_and_current_role(client, db_session, setup, monkeypatch):
    headers = configure(monkeypatch, setup)
    setup["admin"].role = "student"
    db_session.commit()
    assert client.get("/internal/agent/external/principal", headers=headers).status_code == 403
    setup["admin"].role = "admin"
    db_session.commit()
    monkeypatch.setattr(settings, "external_agent_keys", "[]")
    assert client.get("/internal/agent/external/principal", headers=headers).status_code == 401


def test_external_key_cannot_replace_human_confirm_or_service(client, setup, monkeypatch):
    headers = configure(monkeypatch, setup)
    assert client.get("/internal/agent/external/principal",
                      headers={"X-External-Agent-Key": "external-fixture"}).status_code == 401
    assert client.get("/internal/agent/external/principal",
                      headers={**headers, "X-External-Agent-Key": "wrong"}).status_code == 401
    assert client.post("/api/governance/moderation/cases/1/resolve", json={
        "decision": "hide", "manager_feedback": "外部模型自称批准",
    }, headers=headers).status_code == 401


@pytest.mark.parametrize("raw", ["not-json", "{}", "[null]", "[true]", "[]"])
def test_invalid_external_configuration_fails_closed(client, setup, monkeypatch, raw):
    headers = configure(monkeypatch, setup)
    monkeypatch.setattr(settings, "external_agent_keys", raw)
    assert client.get("/internal/agent/external/principal", headers=headers).status_code == 401


@pytest.mark.parametrize("change", ["disabled", "invalid_id", "banned", "missing"])
def test_external_mapping_is_enabled_and_current(client, db_session, setup, monkeypatch, change):
    headers = configure(monkeypatch, setup)
    config = json.loads(settings.external_agent_keys)
    if change == "disabled":
        config[0]["enabled"] = False
    elif change == "invalid_id":
        config[0]["user_id"] = True
    elif change == "missing":
        config[0]["user_id"] = 99999999
    else:
        setup["admin"].status = "banned"
        db_session.commit()
    monkeypatch.setattr(settings, "external_agent_keys", json.dumps(config))
    response = client.get("/internal/agent/external/principal", headers=headers)
    assert response.status_code == (403 if change == "banned" else 401)
    assert "external-fixture" not in response.text


def test_duplicate_external_key_mapping_is_not_order_dependent(client, setup, monkeypatch):
    headers = configure(monkeypatch, setup)
    config = json.loads(settings.external_agent_keys)
    config.append({**config[0], "user_id": setup["other"].id})
    monkeypatch.setattr(settings, "external_agent_keys", json.dumps(config))
    assert client.get("/internal/agent/external/principal", headers=headers).status_code == 401


def test_external_key_cannot_call_legacy_decision_without_human(client, setup, monkeypatch):
    headers = configure(monkeypatch, setup)
    body = requests.request_body(client, setup)
    case = requests.submit(client, setup, body).json()["data"]
    path = f"/internal/agent/moderation-cases/{case['case_id']}/decision"
    response = client.patch(path, json={
        "decision": "hide", "manager_feedback": "自报人工批准",
        "decision_source": "manager_directed",
    }, headers=headers)
    assert response.status_code == 403
