# qa 问题模块测试：发布/编辑/软删除与 E-01/E-02/E-10/X-03 边界（T-04）
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.modules.identity.models import User
from app.modules.qa import domain


def _create_user(db: Session, username: str, role: str = "student") -> User:
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


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_course_with_member(client: TestClient, db: Session, code: str) -> tuple[str, str, int]:
    """测试辅助：教师建课 + 学生加入，返回 (教师token, 学生token, 课程id)。"""
    _create_user(db, f"t_{code}", role="teacher")
    teacher_token = _login(client, f"t_{code}")
    resp = client.post(
        "/api/courses",
        json={"name": f"课程{code}", "code": code},
        headers=_auth(teacher_token),
    )
    course_id = resp.json()["data"]["id"]
    _create_user(db, f"s_{code}")
    student_token = _login(client, f"s_{code}")
    client.post(f"/api/courses/{course_id}/join", headers=_auth(student_token))
    return teacher_token, student_token, course_id


def _publish(
    client: TestClient, token: str, course_id: int,
    title: str = "如何理解递归？", body: str = "请举例说明。",
):
    """测试辅助：发布问题。"""
    return client.post(
        "/api/questions",
        json={"title": title, "body": body, "course_id": course_id},
        headers=_auth(token),
    )


# ---------- 发布（US-03）----------


def test_publish_question_success(client: TestClient, db_session: Session) -> None:
    """已加入课程的学生发布问题成功。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA101")
    resp = _publish(client, student_token, course_id)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "published"
    assert data["title"] == "如何理解递归？"


def test_owner_teacher_publish_without_join(client: TestClient, db_session: Session) -> None:
    """负责教师无需加入即可在自己课程发问题（T-04 决策）。"""
    teacher_token, _, course_id = _make_course_with_member(client, db_session, "QA102")
    resp = _publish(client, teacher_token, course_id)
    assert resp.status_code == 200


def test_publish_without_join_forbidden(client: TestClient, db_session: Session) -> None:
    """未加入课程的学生发布 → 403（学生端接口文档 §3）。"""
    _create_user(db_session, "t_qa103", role="teacher")
    teacher_token = _login(client, "t_qa103")
    resp = client.post(
        "/api/courses", json={"name": "课", "code": "QA103"}, headers=_auth(teacher_token)
    )
    course_id = resp.json()["data"]["id"]

    _create_user(db_session, "outsider")
    token = _login(client, "outsider")
    resp = _publish(client, token, course_id)
    assert resp.status_code == 403


def test_publish_course_not_found(client: TestClient, db_session: Session) -> None:
    """课程不存在 → 404。"""
    _create_user(db_session, "anyone_qa")
    token = _login(client, "anyone_qa")
    resp = _publish(client, token, 9999)
    assert resp.status_code == 404


def test_publish_empty_content_rejected(client: TestClient, db_session: Session) -> None:
    """E-01：空标题 / 空白正文不能提交。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA104")
    assert _publish(client, student_token, course_id, title="   ").status_code == 400
    assert _publish(client, student_token, course_id, body="  ").status_code == 400


def test_publish_without_login(client: TestClient) -> None:
    """未登录发布 → 401（E-08）。"""
    resp = client.post(
        "/api/questions",
        json={"title": "题", "body": "文", "course_id": 1},
    )
    assert resp.status_code == 401


def test_publish_truncates_and_notifies(client: TestClient, db_session: Session) -> None:
    """E-02：超长截断并提示（标题 100 字、正文 20000 字上限）。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA105")
    resp = _publish(
        client, student_token, course_id,
        title="题" * 150, body="文" * (domain.BODY_MAX_LEN + 50),
    )
    assert resp.status_code == 200
    assert "截断" in resp.json()["message"]
    question_id = resp.json()["data"]["id"]
    detail = client.get(
        f"/api/questions/{question_id}", headers=_auth(student_token)
    ).json()["data"]
    assert len(detail["title"]) == domain.TITLE_MAX_LEN
    assert len(detail["body"]) == domain.BODY_MAX_LEN


def test_publish_sanitizes_script(client: TestClient, db_session: Session) -> None:
    """X-03：含脚本的正文清洗后正常入库，不报错。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA106")
    resp = _publish(
        client, student_token, course_id,
        body="看这个<script>alert(1)</script>还有<img src=x onerror=alert(2)>",
    )
    assert resp.status_code == 200
    detail = client.get(
        f"/api/questions/{resp.json()['data']['id']}", headers=_auth(student_token)
    ).json()["data"]
    assert "<script>" not in detail["body"]
    assert "onerror" not in detail["body"]


# ---------- 列表与详情 ----------


def test_list_filters_and_soft_delete_invisible(
    client: TestClient, db_session: Session
) -> None:
    """列表：课程/关键词筛选、软删后普通列表不可见（E-10）。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA201")
    q1 = _publish(client, student_token, course_id, title="递归怎么写").json()["data"]["id"]
    _publish(client, student_token, course_id, title="链表反转技巧")

    # course_id + keyword 组合筛选
    resp = client.get(
        "/api/questions", params={"course_id": course_id, "keyword": "递归"},
        headers=_auth(student_token),
    )
    items = resp.json()["data"]["items"]
    assert len(items) == 1 and items[0]["id"] == q1

    # 软删后列表不可见
    client.delete(f"/api/questions/{q1}", headers=_auth(student_token))
    resp = client.get(
        "/api/questions", params={"course_id": course_id}, headers=_auth(student_token)
    )
    assert all(i["id"] != q1 for i in resp.json()["data"]["items"])


def test_list_invalid_sort_rejected(client: TestClient, db_session: Session) -> None:
    """非法 sort 值 → 400（422 归一）。"""
    _create_user(db_session, "sorter")
    token = _login(client, "sorter")
    resp = client.get(
        "/api/questions", params={"sort": "bogus"}, headers=_auth(token)
    )
    assert resp.status_code == 400


def test_detail_increments_view(client: TestClient, db_session: Session) -> None:
    """详情：浏览数每次 +1。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA202")
    qid = _publish(client, student_token, course_id).json()["data"]["id"]
    first = client.get(f"/api/questions/{qid}", headers=_auth(student_token)).json()["data"]
    second = client.get(f"/api/questions/{qid}", headers=_auth(student_token)).json()["data"]
    assert second["view_count"] == first["view_count"] + 1


def test_detail_soft_deleted_not_found(client: TestClient, db_session: Session) -> None:
    """E-10：软删后详情 404（管理员追溯走数据库，不设独立接口）。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA203")
    qid = _publish(client, student_token, course_id).json()["data"]["id"]
    client.delete(f"/api/questions/{qid}", headers=_auth(student_token))
    resp = client.get(f"/api/questions/{qid}", headers=_auth(student_token))
    assert resp.status_code == 404


# ---------- 编辑（仅作者）----------


def test_author_edit_question(client: TestClient, db_session: Session) -> None:
    """作者可编辑：部分更新 + 新内容清洗。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA301")
    qid = _publish(client, student_token, course_id).json()["data"]["id"]
    resp = client.patch(
        f"/api/questions/{qid}",
        json={"body": "改过的正文<script>x</script>"},
        headers=_auth(student_token),
    )
    assert resp.status_code == 200
    assert "<script>" not in resp.json()["data"]["body"]
    assert "改过的正文" in resp.json()["data"]["body"]


def test_non_author_edit_forbidden(client: TestClient, db_session: Session) -> None:
    """非作者编辑 → 403。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA302")
    qid = _publish(client, student_token, course_id).json()["data"]["id"]
    _create_user(db_session, "other_qa302")
    other_token = _login(client, "other_qa302")
    resp = client.patch(
        f"/api/questions/{qid}", json={"title": "篡改"}, headers=_auth(other_token)
    )
    assert resp.status_code == 403


def test_edit_blank_field_rejected(client: TestClient, db_session: Session) -> None:
    """E-01：编辑时提交空白字段被拒。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA303")
    qid = _publish(client, student_token, course_id).json()["data"]["id"]
    resp = client.patch(
        f"/api/questions/{qid}", json={"title": " "}, headers=_auth(student_token)
    )
    assert resp.status_code == 400


# ---------- 软删除（作者 / 管理员，E-10）----------


def test_author_delete_question(client: TestClient, db_session: Session) -> None:
    """作者软删除自己的问题。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA401")
    qid = _publish(client, student_token, course_id).json()["data"]["id"]
    resp = client.delete(f"/api/questions/{qid}", headers=_auth(student_token))
    assert resp.status_code == 200


def test_admin_delete_others_question(client: TestClient, db_session: Session) -> None:
    """管理员可删除他人问题；普通用户不行。"""
    _, student_token, course_id = _make_course_with_member(client, db_session, "QA402")
    qid = _publish(client, student_token, course_id).json()["data"]["id"]

    _create_user(db_session, "plain_user")
    plain_token = _login(client, "plain_user")
    assert client.delete(
        f"/api/questions/{qid}", headers=_auth(plain_token)
    ).status_code == 403

    _create_user(db_session, "qa_admin", role="admin")
    admin_token = _login(client, "qa_admin")
    assert client.delete(
        f"/api/questions/{qid}", headers=_auth(admin_token)
    ).status_code == 200
