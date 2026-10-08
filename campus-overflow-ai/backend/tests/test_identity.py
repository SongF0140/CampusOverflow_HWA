# identity 模块测试：资料编辑、角色权限、封禁解禁、信息脱敏、助教能力位（T-02a）
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.permissions import require_graduate_assistant
from app.core.response import ok
from app.core.security import hash_password
from app.main import app
from app.modules.identity import repository
from app.modules.identity.models import User


def _create_user(
    db: Session,
    username: str,
    role: str = "student",
    status: str = "active",
    identity_type: str = "undergraduate",
    assistant_cert_status: str = "none",
) -> User:
    """测试辅助：直接在数据库创建用户。"""
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash=hash_password("pass123456"),
        role=role,
        status=status,
        identity_type=identity_type,
        assistant_cert_status=assistant_cert_status,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _login(client: TestClient, username: str) -> str:
    """测试辅助：登录并返回 token。"""
    resp = client.post(
        "/api/auth/login",
        json={"account": username, "password": "pass123456"},
    )
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


@pytest.mark.parametrize("username", ["new", "n" * 50])
def test_update_username_persists_and_login_uses_new_account(
    client: TestClient, db_session: Session, username: str,
) -> None:
    user = _create_user(db_session, "old_account")
    headers = {"Authorization": f"Bearer {_login(client, 'old_account')}"}
    resp = client.patch("/api/users/me", json={"username": username}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["data"]["username"] == username
    assert resp.json()["data"]["id"] == user.id
    assert client.get("/api/users/me", headers=headers).json()["data"]["username"] == username
    assert client.get(f"/api/users/{user.id}").json()["data"]["username"] == username
    for account in (username, "old_account@example.com"):
        login = client.post(
            "/api/auth/login", json={"account": account, "password": "pass123456"},
        )
        assert login.status_code == 200
        assert login.json()["data"]["user"]["id"] == user.id
    assert client.post(
        "/api/auth/login", json={"account": "old_account", "password": "pass123456"},
    ).status_code == 401


def test_update_username_duplicate_rejects_entire_patch(
    client: TestClient, db_session: Session,
) -> None:
    _create_user(db_session, "owner")
    _create_user(db_session, "occupied")
    headers = {"Authorization": f"Bearer {_login(client, 'owner')}"}
    resp = client.patch(
        "/api/users/me", json={"username": "occupied", "bio": "must not persist"},
        headers=headers,
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == 400
    current = client.get("/api/users/me", headers=headers).json()["data"]
    assert current["username"] == "owner"
    assert current["bio"] is None
    assert _login(client, "owner")
    assert _login(client, "occupied")


def test_update_username_unique_constraint_rolls_back(
    client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _create_user(db_session, "owner")
    _create_user(db_session, "occupied")
    headers = {"Authorization": f"Bearer {_login(client, 'owner')}"}
    monkeypatch.setattr(repository, "username_or_email_exists", lambda *args: False)
    resp = client.patch(
        "/api/users/me", json={"username": "occupied", "bio": "must not persist"},
        headers=headers,
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == 400
    current = client.get("/api/users/me", headers=headers).json()["data"]
    assert current["username"] == "owner"
    assert current["bio"] is None


@pytest.mark.parametrize("username", ["", "ab", "n" * 51])
def test_update_username_invalid_length_rejected(
    client: TestClient, db_session: Session, username: str,
) -> None:
    _create_user(db_session, "owner")
    headers = {"Authorization": f"Bearer {_login(client, 'owner')}"}
    resp = client.patch("/api/users/me", json={"username": username}, headers=headers)
    assert resp.status_code == 400
    assert resp.json()["code"] == 400
    assert client.get("/api/users/me", headers=headers).json()["data"]["username"] == "owner"


@pytest.mark.parametrize("patch", [{"username": "owner"}, {"bio": "new bio"}, {}])
def test_update_username_same_or_omitted_keeps_account(
    client: TestClient, db_session: Session, patch: dict,
) -> None:
    _create_user(db_session, "owner")
    headers = {"Authorization": f"Bearer {_login(client, 'owner')}"}
    resp = client.patch("/api/users/me", json=patch, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["data"]["username"] == "owner"
    current = client.get("/api/users/me", headers=headers).json()["data"]
    assert current["username"] == "owner"
    assert current["bio"] == patch.get("bio")


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
    resp = client.post(
        "/api/auth/login",
        json={"account": "banneduser", "password": "pass123456"},
    )
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


# ---------- 助教能力位（T-02a，US-20 / Q-07 / E-12）----------
# 探针路由：模拟第二阶段助教板块接口，专门验证 require_graduate_assistant。

@app.get("/api/test/assistant-board")
def _assistant_board_probe(user=Depends(require_graduate_assistant)) -> dict:
    return ok({"user_id": user.id})


def _assistant_board(client: TestClient, username: str):
    """测试辅助：以指定用户身份访问助教板块探针接口。"""
    token = _login(client, username)
    return client.get(
        "/api/test/assistant-board", headers={"Authorization": f"Bearer {token}"}
    )


def test_undergraduate_cannot_access_assistant_board(
    client: TestClient, db_session: Session
) -> None:
    """E-12 边界一：本科生访问助教板块接口被拒绝。"""
    _create_user(db_session, "undergrad")
    resp = _assistant_board(client, "undergrad")
    assert resp.status_code == 403


def test_uncertified_postgraduate_cannot_access_assistant_board(
    client: TestClient, db_session: Session
) -> None:
    """E-12 边界二：研究生但未通过认证（none/pending/rejected）均被拒绝。"""
    for i, cert_status in enumerate(["none", "pending", "rejected"]):
        _create_user(
            db_session, f"pg{i}", identity_type="postgraduate", assistant_cert_status=cert_status
        )
        resp = _assistant_board(client, f"pg{i}")
        assert resp.status_code == 403, cert_status


def test_approved_postgraduate_can_access_assistant_board(
    client: TestClient, db_session: Session
) -> None:
    """E-12 边界三：学生 + 研究生 + 认证通过 → 助教板块接口放行。"""
    _create_user(
        db_session, "assistant1", identity_type="postgraduate", assistant_cert_status="approved"
    )
    resp = _assistant_board(client, "assistant1")
    assert resp.status_code == 200
    assert "user_id" in resp.json()["data"]


def test_teacher_with_approved_cert_still_denied(client: TestClient, db_session: Session) -> None:
    """能力位仅附加于学生角色：教师即使研究生且认证通过也不放行。"""
    _create_user(
        db_session, "pg_teacher", role="teacher",
        identity_type="postgraduate", assistant_cert_status="approved",
    )
    resp = _assistant_board(client, "pg_teacher")
    assert resp.status_code == 403


def test_me_returns_identity_fields(client: TestClient, db_session: Session) -> None:
    """me 接口返回身份类型与认证状态（前端据此决定是否渲染助教入口）。"""
    _create_user(
        db_session, "meuser", identity_type="postgraduate", assistant_cert_status="pending"
    )
    token = _login(client, "meuser")
    resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["identity_type"] == "postgraduate"
    assert data["assistant_cert_status"] == "pending"


def test_apply_certification_flow(client: TestClient, db_session: Session) -> None:
    """申请流程：学生申请即声明研究生身份并进入待审核。"""
    _create_user(db_session, "applicant")
    token = _login(client, "applicant")
    resp = client.post(
        "/api/users/me/assistant-certification/apply",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["identity_type"] == "postgraduate"
    assert data["assistant_cert_status"] == "pending"


def test_apply_duplicate_while_pending_rejected(client: TestClient, db_session: Session) -> None:
    """pending/approved 状态不可重复申请。"""
    _create_user(
        db_session, "dup_apply", identity_type="postgraduate", assistant_cert_status="pending"
    )
    token = _login(client, "dup_apply")
    resp = client.post(
        "/api/users/me/assistant-certification/apply",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


def test_teacher_cannot_apply(client: TestClient, db_session: Session) -> None:
    """能力位仅学生角色可申请，教师申请被拒绝。"""
    _create_user(db_session, "teacher_apply", role="teacher")
    token = _login(client, "teacher_apply")
    resp = client.post(
        "/api/users/me/assistant-certification/apply",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


def test_review_approve_unlocks_capability(client: TestClient, db_session: Session) -> None:
    """教师审核通过 → 能力位置位，助教板块接口立刻放行。"""
    _create_user(db_session, "teacher_rev1", role="teacher")
    applicant = _create_user(db_session, "pg_apply1")
    # 学生先申请（落 pending）
    student_token = _login(client, "pg_apply1")
    client.post(
        "/api/users/me/assistant-certification/apply",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    # 教师审核通过
    teacher_token = _login(client, "teacher_rev1")
    resp = client.post(
        f"/api/users/{applicant.id}/assistant-certification/review",
        json={"action": "approve"},
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["assistant_cert_status"] == "approved"
    assert _assistant_board(client, "pg_apply1").status_code == 200


def test_review_reject_allows_reapply(client: TestClient, db_session: Session) -> None:
    """教师驳回 → 维持 403；驳回后可重新申请（回到 pending）。"""
    _create_user(db_session, "teacher_rev2", role="teacher")
    applicant = _create_user(db_session, "pg_apply2")
    student_token = _login(client, "pg_apply2")
    client.post(
        "/api/users/me/assistant-certification/apply",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    teacher_token = _login(client, "teacher_rev2")
    resp = client.post(
        f"/api/users/{applicant.id}/assistant-certification/review",
        json={"action": "reject"},
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["assistant_cert_status"] == "rejected"
    assert _assistant_board(client, "pg_apply2").status_code == 403
    # 驳回后可重新申请
    reapply = client.post(
        "/api/users/me/assistant-certification/apply",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert reapply.status_code == 200
    assert reapply.json()["data"]["assistant_cert_status"] == "pending"


def test_review_non_pending_target_rejected(client: TestClient, db_session: Session) -> None:
    """重复审核（目标非 pending）返回 400。"""
    _create_user(db_session, "teacher_rev3", role="teacher")
    target = _create_user(
        db_session, "pg_done", identity_type="postgraduate", assistant_cert_status="approved"
    )
    token = _login(client, "teacher_rev3")
    resp = client.post(
        f"/api/users/{target.id}/assistant-certification/review",
        json={"action": "approve"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


def test_review_non_postgraduate_target_rejected(client: TestClient, db_session: Session) -> None:
    """目标用户不是研究生（身份类型 undergraduate 且未申请）→ 400。"""
    _create_user(db_session, "teacher_rev4", role="teacher")
    target = _create_user(db_session, "plain_undergrad")
    token = _login(client, "teacher_rev4")
    resp = client.post(
        f"/api/users/{target.id}/assistant-certification/review",
        json={"action": "approve"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


def test_review_requires_teacher(client: TestClient, db_session: Session) -> None:
    """学生不能调用审核接口（RBAC）。"""
    _create_user(db_session, "student_rev")
    target = _create_user(
        db_session, "pg_pend", identity_type="postgraduate", assistant_cert_status="pending"
    )
    token = _login(client, "student_rev")
    resp = client.post(
        f"/api/users/{target.id}/assistant-certification/review",
        json={"action": "approve"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_list_certifications_filter_by_status(client: TestClient, db_session: Session) -> None:
    """教师可按状态过滤认证申请列表，返回不含邮箱等隐私字段。"""
    _create_user(db_session, "teacher_list", role="teacher")
    _create_user(
        db_session, "pg_list", identity_type="postgraduate", assistant_cert_status="pending"
    )
    _create_user(
        db_session, "pg_done2", identity_type="postgraduate", assistant_cert_status="approved"
    )
    token = _login(client, "teacher_list")
    resp = client.get(
        "/api/users/assistant-certifications?status=pending",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1
    item = data["items"][0]
    assert item["username"] == "pg_list"
    assert item["certification_status"] == "pending"
    assert "email" not in item
