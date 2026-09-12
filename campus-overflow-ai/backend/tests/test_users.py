# 用户模块测试：资料编辑、角色权限、封禁解禁、信息脱敏
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.modules.users.models import User
from app.core.security import hash_password


def _create_user(db: Session, username: str, role: str = "student", status: str = "active") -> User:
    """测试辅助：直接在数据库创建用户。"""
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash=hash_password("pass123456"),
        role=role,
        status=status,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client: TestClient, username: str) -> str:
    """测试辅助：登录并返回 token。"""
    resp = client.post("/api/auth/login", json={"account": username, "password": "pass123456"})
    return resp.json()["data"]["access_token"]


def test_update_profile_success(client: TestClient, db_session: Session) -> None:
    """用户可以更新自己的 bio 和 avatar。"""
    _create_user(db_session, "ivan")
    token = _login(client, "ivan")
    resp = client.patch(
        "/api/users/me",
        json={"bio": "我是一名学生", "avatar_url": "https://example.com/avatar.png"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["bio"] == "我是一名学生"
    assert resp.json()["data"]["avatar_url"] == "https://example.com/avatar.png"


def test_update_profile_without_token(client: TestClient) -> None:
    """未登录不能更新资料。"""
    resp = client.patch("/api/users/me", json={"bio": "test"})
    assert resp.status_code == 401


def test_get_user_public_without_login(client: TestClient, db_session: Session) -> None:
    """未登录可查看用户公开信息，但不含邮箱。"""
    user = _create_user(db_session, "judy")
    resp = client.get(f"/api/users/{user.id}")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["username"] == "judy"
    assert "email" not in data  # 公开接口不返回邮箱
    assert "ban_reason" not in data  # 公开接口不返回封禁原因


def test_get_me_contains_email(client: TestClient, db_session: Session) -> None:
    """本人查看自己的信息包含邮箱。"""
    _create_user(db_session, "heidi")
    token = _login(client, "heidi")
    resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["data"]["email"] == "heidi@example.com"


def test_admin_list_users(client: TestClient, db_session: Session) -> None:
    """管理员可以查看用户列表。"""
    _create_user(db_session, "admin1", role="admin")
    _create_user(db_session, "user1")
    _create_user(db_session, "user2")
    token = _login(client, "admin1")
    resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["data"]["total"] == 3
    assert len(resp.json()["data"]["items"]) == 3


def test_student_cannot_list_users(client: TestClient, db_session: Session) -> None:
    """学生不能访问管理员用户列表接口（RBAC边界）。"""
    _create_user(db_session, "student1")
    token = _login(client, "student1")
    resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_admin_ban_user_with_reason(client: TestClient, db_session: Session) -> None:
    """管理员封禁用户，封禁原因落库。"""
    _create_user(db_session, "admin2", role="admin")
    target = _create_user(db_session, "baduser")
    token = _login(client, "admin2")
    resp = client.post(
        f"/api/users/{target.id}/ban",
        json={"reason": "违规发言，多次警告无效"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "banned"
    assert data["ban_reason"] == "违规发言，多次警告无效"


def test_banned_user_cannot_login(client: TestClient, db_session: Session) -> None:
    """被封禁用户登录应返回 403。"""
    _create_user(db_session, "banneduser", status="banned")
    resp = client.post("/api/auth/login", json={"account": "banneduser", "password": "pass123456"})
    assert resp.status_code == 403


def test_admin_unban_user_clears_reason(client: TestClient, db_session: Session) -> None:
    """管理员解禁用户，封禁原因被清空。"""
    _create_user(db_session, "admin3", role="admin")
    target = _create_user(db_session, "banned2", status="banned")
    target.ban_reason = "测试封禁原因"
    db_session.commit()
    token = _login(client, "admin3")
    resp = client.post(
        f"/api/users/{target.id}/unban",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "active"
    assert data["ban_reason"] is None


def test_student_cannot_ban(client: TestClient, db_session: Session) -> None:
    """学生不能封禁他人（RBAC核心边界）。"""
    _create_user(db_session, "student2")
    target = _create_user(db_session, "otheruser")
    token = _login(client, "student2")
    resp = client.post(
        f"/api/users/{target.id}/ban",
        json={"reason": "test"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_student_cannot_unban(client: TestClient, db_session: Session) -> None:
    """学生不能解禁他人（RBAC核心边界）。"""
    _create_user(db_session, "student3")
    target = _create_user(db_session, "banned3", status="banned")
    token = _login(client, "student3")
    resp = client.post(
        f"/api/users/{target.id}/unban",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_admin_cannot_ban_another_admin(client: TestClient, db_session: Session) -> None:
    """管理员不能封禁另一个管理员。"""
    _create_user(db_session, "admin4", role="admin")
    target = _create_user(db_session, "admin5", role="admin")
    token = _login(client, "admin4")
    resp = client.post(
        f"/api/users/{target.id}/ban",
        json={"reason": "test"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
