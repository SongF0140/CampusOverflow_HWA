import hashlib
import json
from uuid import uuid4

import pytest
from test_approval_requests import auth
from test_approval_requests import setup as setup  # noqa: F401

from app.core.config import settings

BASE = "/api/governance/private-context"
INTERNAL = "/internal/agent/user/private-context"


@pytest.fixture
def private_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "private_context_root", str(tmp_path / "private"))
    return tmp_path / "private"


def test_memory_version_sensitive_and_account_isolation(client, setup, private_root):
    headers = auth(setup["admin"], service=False)
    assert client.get(f"{BASE}/memory", headers=headers).json()["data"]["version"] == 0
    entry = {"id": str(uuid4()), "content": "喜欢简洁回答", "created_at": "2026-10-29T00:00:00Z"}
    body = {"version": 0, "entries": [entry]}
    first = client.put(f"{BASE}/memory", headers=headers, json=body)
    assert first.status_code == 200
    assert client.put(f"{BASE}/memory", headers=headers, json=body).status_code == 409
    assert (
        client.get(f"{BASE}/memory", headers=auth(setup["other"], service=False)).json()["data"][
            "entries"
        ]
        == []
    )
    assert (
        client.get(f"{BASE}/memory", headers=auth(setup["student"], service=False)).status_code
        == 403
    )
    body["entries"][0]["content"] = "password=abc"
    body["version"] = 1
    assert client.put(f"{BASE}/memory", headers=headers, json=body).status_code == 400


def test_platform_namespaces_and_admin_are_separate(client, setup, private_root, monkeypatch):
    keys = ["platform-a", "platform-b"]
    monkeypatch.setattr(
        settings,
        "external_agent_keys",
        json.dumps(
            [
                {
                    "key_hash": hashlib.sha256(key.encode()).hexdigest(),
                    "user_id": setup["admin"].id,
                    "enabled": True,
                    "client_id": str(uuid4()),
                }
                for key in keys
            ]
        ),
    )
    headers = {"X-Service-Token": settings.agent_service_token, "X-External-Agent-Key": keys[0]}
    item = client.post(
        f"{INTERNAL}/sessions", headers=headers, json={"title": "中台会话", "messages": []}
    )
    assert item.status_code == 200, item.text
    session_id = item.json()["data"]["id"]
    assert (
        client.get(
            f"{BASE}/sessions/{session_id}", headers=auth(setup["admin"], service=False)
        ).status_code
        == 404
    )
    headers["X-External-Agent-Key"] = keys[1]
    assert client.get(f"{INTERNAL}/sessions/{session_id}", headers=headers).status_code == 404
    assert client.get(f"{INTERNAL}/memory", headers=headers).status_code == 403


def test_server_session_ids_import_idempotency_and_tombstone(client, setup, private_root):
    headers = auth(setup["admin"], service=False)
    body = {"title": "演示", "messages": [], "import_key": str(uuid4())}
    first = client.post(f"{BASE}/sessions", headers=headers, json=body).json()["data"]
    second = client.post(f"{BASE}/sessions", headers=headers, json=body).json()["data"]
    assert first["id"] == second["id"] and first["id"] != body["import_key"]
    path = f"{BASE}/sessions/{first['id']}"
    assert (
        client.delete(path, headers={**headers, "If-Match": str(first["version"])}).status_code
        == 200
    )
    assert (
        client.put(
            path,
            headers=headers,
            json={"version": first["version"], "title": "旧响应", "messages": []},
        ).status_code
        == 404
    )
    assert client.get(path, headers=headers).status_code == 404


@pytest.mark.parametrize("broken", ["broken", "{}", "[]"])
def test_corrupt_file_is_not_silently_overwritten(client, setup, private_root, broken):
    headers = auth(setup["admin"], service=False)
    client.get(f"{BASE}/memory", headers=headers)
    path = private_root / "admin" / f"u_{setup['admin'].id}" / "memory.json"
    path.write_text(broken, encoding="utf-8")
    response = client.put(f"{BASE}/memory", headers=headers, json={"version": 0, "entries": []})
    assert response.status_code == 503 and str(private_root) not in response.text
    assert path.read_text(encoding="utf-8") == broken


def test_source_and_path_cannot_be_supplied(client, setup, private_root):
    headers = auth(setup["admin"], service=False)
    assert (
        client.put(
            f"{BASE}/memory",
            headers=headers,
            json={"version": 0, "entries": [], "source": "platform"},
        ).status_code
        == 400
    )
    assert client.get(f"{BASE}/sessions/not-a-uuid", headers=headers).status_code == 400


def test_raw_credentials_are_rejected_in_chat_and_title(client, setup, private_root):
    headers = auth(setup["admin"], service=False)
    raw = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.fakeSignature123456"
    for body in (
        {"title": "会话", "messages": [{"role": "user", "text": raw}]},
        {"title": "token=private-value", "messages": []},
    ):
        response = client.post(f"{BASE}/sessions", headers=headers, json=body)
        assert response.status_code == 400 and raw not in response.text


def test_concurrent_file_updates_conflict_without_overwrite(private_root):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from app.modules.governance.context_files import ContextConflict
    from app.modules.governance.schemas_contexts import MemoryDocument
    from app.modules.governance.service_contexts import memory

    barrier = Barrier(2, timeout=5)

    def write(_):
        barrier.wait()
        try:
            return memory(("admin", "u_1"), MemoryDocument(version=0, entries=[]))["version"]
        except ContextConflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, range(2)))
    assert set(results) == {1, "conflict"}
    assert memory(("admin", "u_1"))["version"] == 1
