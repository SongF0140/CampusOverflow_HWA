# qa 评论模块测试：发表/列表/删除、二级回复边界、E-01/E-02/E-07/E-10/X-03（T-06）
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.modules.identity.models import User


def _create_user(db: Session, username: str, role: str = "student", **extra) -> User:
    """测试辅助：直接在数据库创建用户（extra 传身份状态等字段）。"""
    user = User(
        username=username,
        email=f"{username}@example.com",
        password_hash=hash_password("pass123456"),
        role=role,
        **extra,
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


def _setup(client: TestClient, db: Session, code: str) -> dict:
    """测试辅助：教师建课 + 学生提问 + 他人回答，返回各 token 与问题/回答 id。"""
    _create_user(db, f"t_{code}", role="teacher")
    teacher_token = _login(client, f"t_{code}")
    course_id = client.post(
        "/api/courses",
        json={"name": f"课程{code}", "code": code},
        headers=_auth(teacher_token),
    ).json()["data"]["id"]
    _create_user(db, f"a_{code}")
    asker_token = _login(client, f"a_{code}")
    client.post(f"/api/courses/{course_id}/join", headers=_auth(asker_token))
    question_id = client.post(
        "/api/questions",
        json={"title": f"问题{code}", "body": "请解答。", "course_id": course_id},
        headers=_auth(asker_token),
    ).json()["data"]["id"]
    _create_user(db, f"u_{code}")
    other_token = _login(client, f"u_{code}")
    answer_id = client.post(
        f"/api/questions/{question_id}/answers",
        json={"body": "我的解答。"},
        headers=_auth(other_token),
    ).json()["data"]["id"]
    return {
        "teacher_token": teacher_token,
        "asker_token": asker_token,
        "other_token": other_token,
        "course_id": course_id,
        "question_id": question_id,
        "answer_id": answer_id,
    }


def _comment_question(
    client: TestClient, token: str, question_id: int, body: str, parent_id: int | None = None
):
    return client.post(
        f"/api/questions/{question_id}/comments",
        json={"body": body, "parent_id": parent_id},
        headers=_auth(token),
    )


def _comment_answer(
    client: TestClient, token: str, answer_id: int, body: str, parent_id: int | None = None
):
    return client.post(
        f"/api/answers/{answer_id}/comments",
        json={"body": body, "parent_id": parent_id},
        headers=_auth(token),
    )


def _list_question_comments(client: TestClient, token: str, question_id: int):
    return client.get(
        f"/api/questions/{question_id}/comments", headers=_auth(token)
    ).json()["data"]


# ---------- 发表评论（US-05、E-01、X-03、E-02） ----------


def test_publish_question_comment_ok(client: TestClient, db_session: Session) -> None:
    """评论问题成功：返回 id / parent_id=None / created_at，message 为中文。"""
    ctx = _setup(client, db_session, "C1")
    resp = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "这个问题我也遇到。"
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["id"] > 0
    assert data["parent_id"] is None
    assert "created_at" in data
    assert resp.json()["message"] == "评论成功"


def test_publish_answer_comment_ok(client: TestClient, db_session: Session) -> None:
    """评论回答成功（US-05：评论问题和回答两类目标）。"""
    ctx = _setup(client, db_session, "C2")
    resp = _comment_answer(
        client, ctx["asker_token"], ctx["answer_id"], "感谢解答！"
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["parent_id"] is None


def test_empty_comment_rejected_400(client: TestClient, db_session: Session) -> None:
    """E-01：空评论与纯空白评论不能提交。"""
    ctx = _setup(client, db_session, "C3")
    for body in ["", "   "]:
        resp = _comment_question(client, ctx["other_token"], ctx["question_id"], body)
        assert resp.status_code == 400, f"body={body!r} 应被拒绝"
        assert resp.json()["code"] == 400


def test_comment_sanitizes_script(client: TestClient, db_session: Session) -> None:
    """X-03：评论含脚本内容被清洗后入库，列表展示纯文本。"""
    ctx = _setup(client, db_session, "C4")
    _comment_question(
        client, ctx["other_token"], ctx["question_id"], "正常<script>alert(1)</script>内容"
    )
    items = _list_question_comments(client, ctx["other_token"], ctx["question_id"])["items"]
    assert "<script>" not in items[0]["body"]
    assert "正常" in items[0]["body"] and "内容" in items[0]["body"]


def test_comment_truncated_with_message(client: TestClient, db_session: Session) -> None:
    """E-02：超长评论截断至 1000 字并在 message 提示。"""
    ctx = _setup(client, db_session, "C5")
    resp = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "评" * 1100
    )
    assert resp.status_code == 200
    assert "截断" in resp.json()["message"]
    items = _list_question_comments(client, ctx["other_token"], ctx["question_id"])["items"]
    assert len(items[0]["body"]) == 1000


def test_comment_missing_question_404(client: TestClient, db_session: Session) -> None:
    """评论不存在的问题 → 404。"""
    ctx = _setup(client, db_session, "C6")
    resp = _comment_question(client, ctx["other_token"], 99999, "评论")
    assert resp.status_code == 404


def test_comment_missing_answer_404(client: TestClient, db_session: Session) -> None:
    """评论不存在的回答 → 404。"""
    ctx = _setup(client, db_session, "C7")
    resp = _comment_answer(client, ctx["other_token"], 99999, "评论")
    assert resp.status_code == 404


def test_comment_on_deleted_question_404(client: TestClient, db_session: Session) -> None:
    """E-10：软删问题下不可评论（目标不可见）。"""
    ctx = _setup(client, db_session, "C8")
    client.delete(f"/api/questions/{ctx['question_id']}", headers=_auth(ctx["asker_token"]))
    resp = _comment_question(client, ctx["other_token"], ctx["question_id"], "评论")
    assert resp.status_code == 404


# ---------- 二级回复（US-05） ----------


def test_reply_to_top_comment_ok(client: TestClient, db_session: Session) -> None:
    """二级回复成功：parent_id 回填，列表归组进顶级评论的 replies。"""
    ctx = _setup(client, db_session, "R1")
    top_id = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "顶评"
    ).json()["data"]["id"]
    resp = _comment_question(
        client, ctx["asker_token"], ctx["question_id"], "回复内容", parent_id=top_id
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["parent_id"] == top_id
    data = _list_question_comments(client, ctx["other_token"], ctx["question_id"])
    assert len(data["items"]) == 1
    replies = data["items"][0]["replies"]
    assert len(replies) == 1
    assert replies[0]["parent_id"] == top_id
    assert replies[0]["body"] == "回复内容"


def test_reply_to_reply_rejected_400(client: TestClient, db_session: Session) -> None:
    """US-05 仅支持二级：回复的回复（父评论本身是回复）→ 400。"""
    ctx = _setup(client, db_session, "R2")
    top_id = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "顶评"
    ).json()["data"]["id"]
    reply_id = _comment_question(
        client, ctx["asker_token"], ctx["question_id"], "一级回复", parent_id=top_id
    ).json()["data"]["id"]
    resp = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "二级回复", parent_id=reply_id
    )
    assert resp.status_code == 400


def test_reply_cross_target_rejected_400(client: TestClient, db_session: Session) -> None:
    """回复的父评论必须挂在同一目标下：跨问题回复 → 400。"""
    ctx = _setup(client, db_session, "R3")
    top_id = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "问题A的评论"
    ).json()["data"]["id"]
    other_question_id = client.post(
        "/api/questions",
        json={"title": "问题B", "body": "内容", "course_id": ctx["course_id"]},
        headers=_auth(ctx["asker_token"]),
    ).json()["data"]["id"]
    resp = _comment_question(
        client, ctx["asker_token"], other_question_id, "跨目标回复", parent_id=top_id
    )
    assert resp.status_code == 400


def test_reply_to_missing_parent_400(client: TestClient, db_session: Session) -> None:
    """父评论不存在 → 400。"""
    ctx = _setup(client, db_session, "R4")
    resp = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "回复", parent_id=99999
    )
    assert resp.status_code == 400


def test_reply_to_deleted_parent_400(client: TestClient, db_session: Session) -> None:
    """父评论已删除 → 400（不可回复已删评论）。"""
    ctx = _setup(client, db_session, "R5")
    top_id = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "顶评"
    ).json()["data"]["id"]
    client.delete(f"/api/comments/{top_id}", headers=_auth(ctx["other_token"]))
    resp = _comment_question(
        client, ctx["asker_token"], ctx["question_id"], "回复已删评论", parent_id=top_id
    )
    assert resp.status_code == 400


# ---------- 评论列表（E-10） ----------


def test_list_comments_pagination_and_grouping(
    client: TestClient, db_session: Session
) -> None:
    """列表分页只作用于顶级评论，回复全量归组；total 为顶级评论数。"""
    ctx = _setup(client, db_session, "L1")
    ids = [
        _comment_question(
            client, ctx["other_token"], ctx["question_id"], f"顶评{i}"
        ).json()["data"]["id"]
        for i in range(3)
    ]
    _comment_question(
        client, ctx["asker_token"], ctx["question_id"], "给顶评1的回复", parent_id=ids[1]
    )
    data = _list_question_comments(client, ctx["other_token"], ctx["question_id"])
    assert data["total"] == 3
    assert len(data["items"]) == 3
    replies = data["items"][1]["replies"]
    assert len(replies) == 1 and replies[0]["parent_id"] == ids[1]
    for item in data["items"]:
        assert item["parent_id"] is None


def test_deleted_comment_invisible_in_list(
    client: TestClient, db_session: Session
) -> None:
    """E-10：被删除评论普通列表不可见。"""
    ctx = _setup(client, db_session, "L2")
    top_id = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "将被删除的评论"
    ).json()["data"]["id"]
    _comment_question(client, ctx["asker_token"], ctx["question_id"], "留存评论")
    client.delete(f"/api/comments/{top_id}", headers=_auth(ctx["other_token"]))
    items = _list_question_comments(client, ctx["other_token"], ctx["question_id"])["items"]
    assert [i["id"] for i in items] != [top_id]
    assert len(items) == 1 and items[0]["body"] == "留存评论"


# ---------- 删除权限（US-05：作者删自己，管理员删违规） ----------


def test_author_deletes_own_comment(client: TestClient, db_session: Session) -> None:
    """作者删除自己的评论 → 200。"""
    ctx = _setup(client, db_session, "D1")
    top_id = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "我的评论"
    ).json()["data"]["id"]
    resp = client.delete(f"/api/comments/{top_id}", headers=_auth(ctx["other_token"]))
    assert resp.status_code == 200
    assert resp.json()["message"] == "已删除"


def test_admin_deletes_others_comment(client: TestClient, db_session: Session) -> None:
    """管理员删除违规评论 → 200（US-05）。"""
    ctx = _setup(client, db_session, "D2")
    top_id = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "违规评论"
    ).json()["data"]["id"]
    _create_user(db_session, "admin_d2", role="admin")
    admin_token = _login(client, "admin_d2")
    resp = client.delete(f"/api/comments/{top_id}", headers=_auth(admin_token))
    assert resp.status_code == 200


def test_other_user_delete_403(client: TestClient, db_session: Session) -> None:
    """非作者且非管理员删除他人评论 → 403。"""
    ctx = _setup(client, db_session, "D3")
    top_id = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "他人评论"
    ).json()["data"]["id"]
    resp = client.delete(f"/api/comments/{top_id}", headers=_auth(ctx["asker_token"]))
    assert resp.status_code == 403


def test_delete_top_comment_hides_replies(
    client: TestClient, db_session: Session
) -> None:
    """删除顶级评论级联隐藏其直接回复（避免回复孤儿化，实现补充语义）。"""
    ctx = _setup(client, db_session, "D4")
    top_id = _comment_question(
        client, ctx["other_token"], ctx["question_id"], "顶评"
    ).json()["data"]["id"]
    _comment_question(
        client, ctx["asker_token"], ctx["question_id"], "回复甲", parent_id=top_id
    )
    _comment_question(
        client, ctx["other_token"], ctx["question_id"], "回复乙", parent_id=top_id
    )
    client.delete(f"/api/comments/{top_id}", headers=_auth(ctx["other_token"]))
    data = _list_question_comments(client, ctx["other_token"], ctx["question_id"])
    assert data["items"] == []


def test_delete_missing_comment_404(client: TestClient, db_session: Session) -> None:
    """删除不存在的评论 → 404。"""
    ctx = _setup(client, db_session, "D5")
    resp = client.delete("/api/comments/99999", headers=_auth(ctx["other_token"]))
    assert resp.status_code == 404


# ---------- 封禁与未登录（E-07、E-08） ----------


def test_banned_user_cannot_comment_403(client: TestClient, db_session: Session) -> None:
    """E-07：封禁用户评论 403（get_current_user 统一拦截）。"""
    ctx = _setup(client, db_session, "B1")
    user = _create_user(db_session, "banned_c1")
    token = _login(client, "banned_c1")
    user.status = "banned"
    db_session.commit()
    resp = _comment_question(client, token, ctx["question_id"], "被封禁后评论")
    assert resp.status_code == 403


def test_unauthenticated_comment_401(client: TestClient, db_session: Session) -> None:
    """E-08：未登录评论 → 401。"""
    ctx = _setup(client, db_session, "B2")
    resp = client.post(
        f"/api/questions/{ctx['question_id']}/comments", json={"body": "评论"}
    )
    assert resp.status_code == 401
