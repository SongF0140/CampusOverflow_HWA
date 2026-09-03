from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_up() -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["data"]["status"] == "up"
    assert body["data"]["service"] == "backend"


def test_health_root_alias() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["data"]["service"] == "backend"
