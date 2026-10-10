# courses 模块测试：创建/编辑权限、课程列表详情、加入退出边界（T-03）
# 核心完成判定：教师不能管理他人课程（管理员除外，E-06）。
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.modules.identity.models import User


def _create_user(
    db: Session, username: str, role: str = "student"
) -> User:
    """测试辅助：直接在数据库创建用户。"""
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash=hash_password("pass123456"),
        role=role,
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


def _create_course(
    client: TestClient, token: str, code: str,
    name: str = "数据结构", semester: str | None = None,
) -> dict:
    """测试辅助：教师创建课程并返回 data。"""
    resp = client.post(
        "/api/courses",
        json={"name": name, "code": code, "semester": semester},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.json()
    return resp.json()["data"]


def _join(client: TestClient, token: str, course_id: int):
    """测试辅助：学生加入课程。"""
    return client.post(
        f"/api/courses/{course_id}/join",
        headers={"Authorization": f"Bearer {token}"},
    )


# ---------- 创建课程 ----------


def test_teacher_create_course(client: TestClient, db_session: Session) -> None:
    """教师创建课程成功，创建者自动成为负责教师。"""
    _create_user(db_session, "teacher_wang", role="teacher")
    token = _login(client, "teacher_wang")
    data = _create_course(client, token, "CS101", semester="2025-2026-1")
    assert data["name"] == "数据结构"
    assert data["code"] == "CS101"
    assert data["semester"] == "2025-2026-1"
    assert data["teacher_id"] > 0


def test_student_create_course_forbidden(client: TestClient, db_session: Session) -> None:
    """学生不能创建课程（教师端接口文档 §1：非教师 403）。"""
    _create_user(db_session, "student_zhang")
    token = _login(client, "student_zhang")
    resp = client.post(
        "/api/courses",
        json={"name": "越权课", "code": "X001"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_create_course_duplicate_code(client: TestClient, db_session: Session) -> None:
    """课程编码重复 → 400（编码全局唯一）。"""
    _create_user(db_session, "teacher_li", role="teacher")
    token = _login(client, "teacher_li")
    _create_course(client, token, "CS101")
    resp = client.post(
        "/api/courses",
        json={"name": "另一门课", "code": "CS101"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert "编码" in resp.json()["message"]


def test_create_course_without_login(client: TestClient) -> None:
    """未登录创建课程 → 401。"""
    resp = client.post("/api/courses", json={"name": "课", "code": "C1"})
    assert resp.status_code == 401


# ---------- 课程列表与详情 ----------


def test_list_courses_with_filters(client: TestClient, db_session: Session) -> None:
    """课程列表：教师名与成员数正确，keyword/semester 筛选生效。"""
    teacher = _create_user(db_session, "teacher_chen", role="teacher")
    token = _login(client, "teacher_chen")
    c1 = _create_course(client, token, "CS101", name="数据结构", semester="2025-2026-1")
    _create_course(client, token, "CS102", name="操作系统", semester="2025-2026-2")

    _create_user(db_session, "student_zhao")
    _join(client, _login(client, "student_zhao"), c1["id"])

    # 全量列表：teacher_name 与 member_count
    resp = client.get("/api/courses", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["total"] == 2
    first = next(i for i in body["items"] if i["id"] == c1["id"])
    assert first["teacher_name"] == teacher.username
    assert first["member_count"] == 1
    assert first["question_count"] == 0  # T-04 回填前固定 0

    # keyword 命中课程名
    resp = client.get(
        "/api/courses", params={"keyword": "数据"},
        headers={"Authorization": f"Bearer {token}"},
    )
    items = resp.json()["data"]["items"]
    assert len(items) == 1 and items[0]["code"] == "CS101"

    # semester 精确筛选
    resp = client.get(
        "/api/courses", params={"semester": "2025-2026-2"},
        headers={"Authorization": f"Bearer {token}"},
    )
    items = resp.json()["data"]["items"]
    assert len(items) == 1 and items[0]["code"] == "CS102"


def test_course_detail_joined_flag(client: TestClient, db_session: Session) -> None:
    """课程详情：joined 反映当前用户加入状态；聚合区块为空数组。"""
    teacher_token = _login(client, "teacher_zhou") if _create_user(
        db_session, "teacher_zhou", role="teacher"
    ) else ""
    course = _create_course(client, teacher_token, "CS201")

    student_token = _login(client, "student_qian") if _create_user(
        db_session, "student_qian"
    ) else ""
    resp = client.get(
        f"/api/courses/{course['id']}",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["joined"] is False
    assert data["aggregates"]["hot_questions"] == []  # T-04 回填前空数组

    _join(client, student_token, course["id"])
    resp = client.get(
        f"/api/courses/{course['id']}",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert resp.json()["data"]["joined"] is True


def test_course_detail_not_found(client: TestClient, db_session: Session) -> None:
    """课程不存在 → 404。"""
    _create_user(db_session, "student_sun")
    token = _login(client, "student_sun")
    resp = client.get("/api/courses/9999", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404


# ---------- 加入与退出 ----------


def test_join_and_leave_course(client: TestClient, db_session: Session) -> None:
    """学生加入/退出课程主流程。"""
    _create_user(db_session, "teacher_zheng", role="teacher")
    teacher_token = _login(client, "teacher_zheng")
    course = _create_course(client, teacher_token, "CS301")

    _create_user(db_session, "student_feng")
    token = _login(client, "student_feng")
    assert _join(client, token, course["id"]).status_code == 200
    # 重复加入 → 400
    assert _join(client, token, course["id"]).status_code == 400
    # 退出成功
    resp = client.delete(
        f"/api/courses/{course['id']}/members/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["joined"] is False
    # 未加入再退出 → 400
    resp = client.delete(
        f"/api/courses/{course['id']}/members/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


def test_teacher_cannot_join_course(client: TestClient, db_session: Session) -> None:
    """加入课程仅限学生：教师调用 → 403（学生端接口文档 §2：登录学生）。"""
    _create_user(db_session, "teacher_wei", role="teacher")
    token = _login(client, "teacher_wei")
    course = _create_course(client, token, "CS401")
    resp = _join(client, token, course["id"])
    assert resp.status_code == 403


def test_join_course_not_found(client: TestClient, db_session: Session) -> None:
    """加入不存在的课程 → 404。"""
    _create_user(db_session, "student_tao")
    token = _login(client, "student_tao")
    assert _join(client, token, 9999).status_code == 404


# ---------- 编辑课程（E-06 核心完成判定）----------


def test_owner_teacher_update_course(client: TestClient, db_session: Session) -> None:
    """负责教师可以编辑自己的课程。"""
    _create_user(db_session, "owner_teacher", role="teacher")
    token = _login(client, "owner_teacher")
    course = _create_course(client, token, "CS501")
    resp = client.patch(
        f"/api/courses/{course['id']}",
        json={"name": "高级数据结构", "description": "进阶班"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["name"] == "高级数据结构"
    assert data["description"] == "进阶班"
    assert data["code"] == "CS501"  # 编码不可编辑


def test_other_teacher_update_course_forbidden(
    client: TestClient, db_session: Session
) -> None:
    """教师不能管理他人课程 → 403（E-06，T-03 核心完成判定）。"""
    _create_user(db_session, "course_owner", role="teacher")
    owner_token = _login(client, "course_owner")
    course = _create_course(client, owner_token, "CS601")

    _create_user(db_session, "other_teacher", role="teacher")
    other_token = _login(client, "other_teacher")
    resp = client.patch(
        f"/api/courses/{course['id']}",
        json={"name": "恶意改名"},
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp.status_code == 403


def test_admin_update_any_course(client: TestClient, db_session: Session) -> None:
    """管理员编辑他人课程不受限（教师端接口文档 §1：管理员走同一接口不受此限）。"""
    _create_user(db_session, "teacher_king", role="teacher")
    owner_token = _login(client, "teacher_king")
    course = _create_course(client, owner_token, "CS701")

    _create_user(db_session, "super_admin", role="admin")
    admin_token = _login(client, "super_admin")
    resp = client.patch(
        f"/api/courses/{course['id']}",
        json={"name": "管理员修订名"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["name"] == "管理员修订名"


def test_student_update_course_forbidden(client: TestClient, db_session: Session) -> None:
    """学生编辑课程 → 403（E-06）。"""
    _create_user(db_session, "teacher_long", role="teacher")
    teacher_token = _login(client, "teacher_long")
    course = _create_course(client, teacher_token, "CS801")

    _create_user(db_session, "student_lu")
    token = _login(client, "student_lu")
    resp = client.patch(
        f"/api/courses/{course['id']}",
        json={"name": "乱改"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


def test_update_course_not_found(client: TestClient, db_session: Session) -> None:
    """编辑不存在的课程 → 404。"""
    _create_user(db_session, "teacher_pan", role="teacher")
    token = _login(client, "teacher_pan")
    resp = client.patch(
        "/api/courses/9999", json={"name": "幽灵课"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


# ---------- 成员列表 ----------


def test_owner_teacher_view_members(client: TestClient, db_session: Session) -> None:
    """负责教师查看成员列表：用户名与加入时间正确。"""
    _create_user(db_session, "teacher_gao", role="teacher")
    teacher_token = _login(client, "teacher_gao")
    course = _create_course(client, teacher_token, "CS901")

    _create_user(db_session, "student_he")
    student_token = _login(client, "student_he")
    _join(client, student_token, course["id"])

    resp = client.get(
        f"/api/courses/{course['id']}/members",
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["total"] == 1
    assert body["items"][0]["username"] == "student_he"
    assert body["items"][0]["joined_at"] is not None


def test_admin_view_members(client: TestClient, db_session: Session) -> None:
    """管理员可查看任意课程成员列表。"""
    _create_user(db_session, "teacher_ding", role="teacher")
    owner_token = _login(client, "teacher_ding")
    course = _create_course(client, owner_token, "CS951")

    _create_user(db_session, "admin_root", role="admin")
    admin_token = _login(client, "admin_root")
    resp = client.get(
        f"/api/courses/{course['id']}/members",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200


def test_other_teacher_view_members_forbidden(
    client: TestClient, db_session: Session
) -> None:
    """他人课程的教师查看成员列表 → 403（E-06）。"""
    _create_user(db_session, "teacher_xie", role="teacher")
    owner_token = _login(client, "teacher_xie")
    course = _create_course(client, owner_token, "CS961")

    _create_user(db_session, "intruder_teacher", role="teacher")
    other_token = _login(client, "intruder_teacher")
    resp = client.get(
        f"/api/courses/{course['id']}/members",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert resp.status_code == 403


def test_student_view_members_forbidden(client: TestClient, db_session: Session) -> None:
    """学生查看成员列表 → 403（成员列表仅负责教师/管理员）。"""
    _create_user(db_session, "teacher_fang", role="teacher")
    teacher_token = _login(client, "teacher_fang")
    course = _create_course(client, teacher_token, "CS971")

    _create_user(db_session, "student_gu")
    student_token = _login(client, "student_gu")
    resp = client.get(
        f"/api/courses/{course['id']}/members",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert resp.status_code == 403
