# 发现模块测试（T-09，US-09/US-10）：搜索、组合筛选、相关问题、课程视图真实聚合
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.modules.identity.models import User


def _create_user(db: Session, username: str, role: str = "student", **extra) -> User:
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
    resp = client.post(
        "/api/auth/login", json={"account": username, "password": "pass123456"}
    )
    return resp.json()["data"]["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _setup(client: TestClient, db: Session, code: str) -> dict:
    """测试辅助：教师建课 + a 加入；返回 token 与 course_id。"""
    _create_user(db, f"t_{code}", role="teacher")
    teacher_token = _login(client, f"t_{code}")
    course_id = client.post(
        "/api/courses", json={"name": f"课程{code}", "code": code},
        headers=_auth(teacher_token),
    ).json()["data"]["id"]
    _create_user(db, f"a_{code}")
    asker_token = _login(client, f"a_{code}")
    client.post(f"/api/courses/{course_id}/join", headers=_auth(asker_token))
    return {
        "teacher_token": teacher_token,
        "asker_token": asker_token,
        "course_id": course_id,
    }


def _ask(client: TestClient, token: str, course_id: int, title: str, body: str) -> int:
    return client.post(
        "/api/questions", json={"title": title, "body": body, "course_id": course_id},
        headers=_auth(token),
    ).json()["data"]["id"]


def _bind_tags(client: TestClient, token: str, question_id: int, names: list[str]) -> None:
    client.post(
        f"/api/questions/{question_id}/tags", json={"tag_ids": names}, headers=_auth(token)
    )


# ---------- 综合搜索（US-09） ----------


def test_search_matches_title_and_body(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "D1")
    _ask(client, ctx["asker_token"], ctx["course_id"], "如何理解TCP三次握手", "正文无关。")
    _ask(client, ctx["asker_token"], ctx["course_id"], "另一个问题", "正文里讲TCP握手。")
    _ask(client, ctx["asker_token"], ctx["course_id"], "无关问题", "完全不同的主题。")
    data = client.get(
        "/api/search", params={"q": "TCP"}, headers=_auth(ctx["asker_token"])
    ).json()["data"]
    assert data["total"] == 2  # 标题命中"TCP三次握手"、正文命中"TCP握手"
    # 未登录 401
    assert client.get("/api/search", params={"q": "TCP"}).status_code == 401


def test_search_keyword_validation_and_combo_filters(
    client: TestClient, db_session: Session
) -> None:
    ctx = _setup(client, db_session, "D2")
    q1 = _ask(client, ctx["asker_token"], ctx["course_id"], "排序算法对比", "快排与归并。")
    # 空白与超长关键词 → 400（中文提示）
    blank = client.get("/api/search", params={"q": "   "}, headers=_auth(ctx["asker_token"]))
    assert blank.status_code == 400
    assert client.get(
        "/api/search", params={"q": "字" * 101}, headers=_auth(ctx["asker_token"])
    ).status_code == 400
    # 组合筛选：course_id + unresolved + 标签 + 时间（带时区）
    _bind_tags(client, ctx["asker_token"], q1, ["算法"])
    tag_id = client.get(
        "/api/tags", params={"keyword": "算法"}, headers=_auth(ctx["asker_token"])
    ).json()["data"]["items"][0]["id"]
    combo = client.get(
        "/api/search",
        params={"q": "排序", "course_id": ctx["course_id"], "unresolved": True, "tag_id": tag_id},
        headers=_auth(ctx["asker_token"]),
    ).json()["data"]
    assert combo["total"] == 1 and combo["items"][0]["id"] == q1
    # 时间窗口：未来起点 → 空；无时区 → 400
    future = client.get(
        "/api/search",
        params={"q": "排序", "created_from": "2030-01-01T00:00:00Z"},
        headers=_auth(ctx["asker_token"]),
    ).json()["data"]
    assert future["total"] == 0
    naive = client.get(
        "/api/search",
        params={"q": "排序", "created_from": "2030-01-01T00:00:00"},
        headers=_auth(ctx["asker_token"]),
    )
    assert naive.status_code == 400


# ---------- 相关问题（US-10：标签交集，最多 10，软删排除） ----------


def test_related_questions_ranking_and_soft_delete(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "D3")
    q1 = _ask(client, ctx["asker_token"], ctx["course_id"], "主问题", "内容一。")
    q2 = _ask(client, ctx["asker_token"], ctx["course_id"], "双标签相关", "内容二。")
    q3 = _ask(client, ctx["asker_token"], ctx["course_id"], "单标签相关", "内容三。")
    _ask(client, ctx["asker_token"], ctx["course_id"], "无标签无关", "内容四。")
    _bind_tags(client, ctx["asker_token"], q1, ["性能", "网络"])
    _bind_tags(client, ctx["asker_token"], q2, ["性能", "网络"])
    _bind_tags(client, ctx["asker_token"], q3, ["性能"])
    data = client.get(
        f"/api/questions/{q1}/related", headers=_auth(ctx["asker_token"])
    ).json()["data"]["items"]
    assert [i["id"] for i in data] == [q2, q3]  # 交集数降序；排除自身与无交集问题
    # 软删 q2 后不再出现
    client.delete(f"/api/questions/{q2}", headers=_auth(ctx["asker_token"]))
    data = client.get(
        f"/api/questions/{q1}/related", headers=_auth(ctx["asker_token"])
    ).json()["data"]["items"]
    assert [i["id"] for i in data] == [q3]
    # 源问题不存在 → 404
    missing = client.get("/api/questions/99999/related", headers=_auth(ctx["asker_token"]))
    assert missing.status_code == 404


# ---------- 课程视图（US-10：列表计数与详情聚合真实数据） ----------


def test_course_list_question_count_and_filters(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "D4")
    course2_id = client.post(
        "/api/courses", json={"name": "第二门课", "code": "D4B"},
        headers=_auth(ctx["teacher_token"]),
    ).json()["data"]["id"]
    _ask(client, ctx["asker_token"], ctx["course_id"], "计数问题", "内容。")
    data = client.get("/api/courses", headers=_auth(ctx["asker_token"])).json()["data"]["items"]
    counts = {c["id"]: c["question_count"] for c in data}
    assert counts[ctx["course_id"]] == 1 and counts[course2_id] == 0
    by_name = client.get(
        "/api/courses", params={"keyword": "第二门"}, headers=_auth(ctx["asker_token"])
    ).json()["data"]
    assert by_name["total"] == 1 and by_name["items"][0]["id"] == course2_id


def test_course_detail_aggregates_real_data(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "D5")
    q1 = _ask(client, ctx["asker_token"], ctx["course_id"], "聚合问题", "内容。")
    _bind_tags(client, ctx["asker_token"], q1, ["数据库"])
    answer_id = client.post(
        f"/api/questions/{q1}/answers", json={"body": "解答。"},
        headers=_auth(ctx["asker_token"]),
    ).json()["data"]["id"]
    data = client.get(
        f"/api/courses/{ctx['course_id']}", headers=_auth(ctx["asker_token"])
    ).json()["data"]
    agg = data["aggregates"]
    assert [q["id"] for q in agg["hot_questions"]] == [q1]
    assert [q["id"] for q in agg["frequent_questions"]] == [q1]
    assert agg["tags"][0]["name"] == "数据库" and agg["tags"][0]["question_count"] == 1
    active = {u["user_id"]: u["activity_count"] for u in agg["active_users"]}
    asker_id = db_session.query(User.id).filter(User.username == "a_D5").scalar()
    assert active[asker_id] == 2  # 1 提问 + 1 回答
    assert answer_id > 0
    assert client.get("/api/courses/99999", headers=_auth(ctx["asker_token"])).status_code == 404


def test_course_questions_endpoint(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "D6")
    q1 = _ask(client, ctx["asker_token"], ctx["course_id"], "课程内问题", "内容。")
    q2 = _ask(client, ctx["asker_token"], ctx["course_id"], "已解决问题", "内容。")
    data = client.get(
        f"/api/courses/{ctx['course_id']}/questions",
        params={"unresolved": True}, headers=_auth(ctx["asker_token"]),
    ).json()["data"]
    assert data["total"] == 2 and {q1, q2} == {i["id"] for i in data["items"]}
    assert client.get(
        "/api/courses/99999/questions", headers=_auth(ctx["asker_token"])
    ).status_code == 404
