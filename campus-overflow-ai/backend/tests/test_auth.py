# 认证模块测试：注册、登录、越权访问
from fastapi.testclient import TestClient


def test_register_success(client: TestClient) -> None:
    """正常注册应返回 200 和用户信息。"""
    resp = client.post("/api/auth/register", json={
        "username": "alice",
        "email": "alice@example.com",
        "password": "password123",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert body["data"]["username"] == "alice"
    assert body["data"]["role"] == "student"
    assert "password_hash" not in body["data"]


def test_register_duplicate_username(client: TestClient) -> None:
    """重复用户名注册应返回 400。"""
    client.post("/api/auth/register", json={
        "username": "bob", "email": "bob@example.com", "password": "pass123456",
    })
    resp = client.post("/api/auth/register", json={
        "username": "bob", "email": "bob2@example.com", "password": "pass123456",
    })
    assert resp.status_code == 400


def test_register_duplicate_email(client: TestClient) -> None:
    """重复邮箱注册应返回 400。"""
    client.post("/api/auth/register", json={
        "username": "carol", "email": "carol@example.com", "password": "pass123456",
    })
    resp = client.post("/api/auth/register", json={
        "username": "carol2", "email": "carol@example.com", "password": "pass123456",
    })
    assert resp.status_code == 400


def test_register_short_password(client: TestClient) -> None:
    """密码过短应返回 422（Pydantic 校验）。"""
    resp = client.post("/api/auth/register", json={
        "username": "dave", "email": "dave@example.com", "password": "123",
    })
    assert resp.status_code == 422


def test_login_success_with_username(client: TestClient) -> None:
    """用户名登录成功应返回 token。"""
    client.post("/api/auth/register", json={
        "username": "eve", "email": "eve@example.com", "password": "pass123456",
    })
    resp = client.post("/api/auth/login", json={
        "account": "eve", "password": "pass123456",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 200
    assert "access_token" in body["data"]
    assert body["data"]["token_type"] == "bearer"


def test_login_success_with_email(client: TestClient) -> None:
    """邮箱登录成功应返回 token。"""
    client.post("/api/auth/register", json={
        "username": "frank", "email": "frank@example.com", "password": "pass123456",
    })
    resp = client.post("/api/auth/login", json={
        "account": "frank@example.com", "password": "pass123456",
    })
    assert resp.status_code == 200
    assert "access_token" in resp.json()["data"]


def test_login_wrong_password(client: TestClient) -> None:
    """密码错误应返回 401。"""
    client.post("/api/auth/register", json={
        "username": "grace", "email": "grace@example.com", "password": "pass123456",
    })
    resp = client.post("/api/auth/login", json={
        "account": "grace", "password": "wrongpassword",
    })
    assert resp.status_code == 401


def test_login_nonexistent_user(client: TestClient) -> None:
    """不存在的用户登录应返回 401。"""
    resp = client.post("/api/auth/login", json={
        "account": "nobody", "password": "pass123456",
    })
    assert resp.status_code == 401


def test_get_me_without_token(client: TestClient) -> None:
    """未登录访问 /users/me 应返回 401。"""
    resp = client.get("/api/users/me")
    assert resp.status_code == 401


def test_get_me_with_token(client: TestClient) -> None:
    """携带有效 token 访问 /users/me 应返回当前用户。"""
    client.post("/api/auth/register", json={
        "username": "heidi", "email": "heidi@example.com", "password": "pass123456",
    })
    login_resp = client.post("/api/auth/login", json={
        "account": "heidi", "password": "pass123456",
    })
    token = login_resp.json()["data"]["access_token"]
    resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["data"]["username"] == "heidi"
