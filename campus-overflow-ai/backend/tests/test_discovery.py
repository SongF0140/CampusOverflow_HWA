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


def test_contract_smoke_courses(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "C1")
    other = _setup(client, db_session, "C2")
    headers = _auth(ctx["asker_token"])
    items = client.get("/api/courses", headers=headers).json()["data"]["items"]
    joined = {item["id"]: item["joined"] for item in items}
    assert joined == {ctx["course_id"]: True, other["course_id"]: False}
    mine = client.get(
        "/api/courses", params={"mine": True, "page_size": 1},
        headers=_auth(ctx["teacher_token"]),
    ).json()["data"]
    assert mine["total"] == 1 and mine["items"][0]["id"] == ctx["course_id"]
    assert mine["page"] == 1 and mine["page_size"] == 1
    filtered = client.get(
        "/api/courses", params={"mine": True, "keyword": "课程C2"},
        headers=_auth(ctx["teacher_token"]),
    ).json()["data"]
    assert filtered["total"] == 0 and filtered["items"] == []
    assert client.get(
        "/api/courses", params={"mine": True}, headers=headers,
    ).json()["data"]["total"] == 0
    for token, course_id, expected in [
        (ctx["teacher_token"], ctx["course_id"], (False, True, True)),
        (ctx["asker_token"], ctx["course_id"], (True, False, True)),
        (ctx["asker_token"], other["course_id"], (False, False, False)),
    ]:
        detail = client.get(f"/api/courses/{course_id}", headers=_auth(token)).json()["data"]
        assert (detail["joined"], detail["is_owner"], detail["can_post"]) == expected
    assert client.post(
        "/api/questions", json={"title": "无资格", "body": "内容", "course_id": other["course_id"]},
        headers=headers,
    ).status_code == 403
    owner_question = _ask(client, ctx["teacher_token"], ctx["course_id"], "教师提问", "内容")
    assert owner_question > 0


def test_contract_smoke_question_cards(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "C3")
    other = _setup(client, db_session, "C4")
    q1 = _ask(client, ctx["asker_token"], ctx["course_id"], "共同主题一", "内容")
    q2 = _ask(client, other["asker_token"], other["course_id"], "共同主题二", "内容")
    _bind_tags(client, ctx["asker_token"], q1, ["共同标签"])
    _bind_tags(client, other["asker_token"], q2, ["共同标签"])
    headers = _auth(ctx["asker_token"])
    for path, params in [("/api/questions", {}), ("/api/search", {"q": "共同主题"})]:
        items = client.get(path, params=params, headers=headers).json()["data"]["items"]
        assert {item["id"]: item["course_name"] for item in items} == {
            q1: "课程C3", q2: "课程C4",
        }
    detail = client.get(f"/api/questions/{q1}", headers=headers).json()["data"]
    assert detail["course_name"] == "课程C3"
    related = client.get(f"/api/questions/{q1}/related", headers=headers).json()["data"]
    assert related["items"][0]["course_name"] == "课程C4"
    course = client.get(f"/api/courses/{ctx['course_id']}", headers=headers).json()["data"]
    assert course["aggregates"]["hot_questions"][0]["course_name"] == "课程C3"
    assert course["aggregates"]["frequent_questions"][0]["course_name"] == "课程C3"
    cards = client.get(
        f"/api/courses/{ctx['course_id']}/questions", headers=headers,
    ).json()["data"]["items"]
    assert cards[0]["course_name"] == "课程C3"


def test_contract_smoke_tag_detail(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "C5")
    headers = _auth(ctx["asker_token"])
    q1 = _ask(client, ctx["asker_token"], ctx["course_id"], "标签计数", "内容")
    q2 = _ask(client, ctx["asker_token"], ctx["course_id"], "保留问题", "内容")
    _bind_tags(client, ctx["asker_token"], q1, ["统计标签"])
    tag = client.get("/api/tags", headers=headers).json()["data"]["items"][0]
    path = f"/api/tags/{tag['id']}"
    assert client.get(path, headers=headers).json()["data"] == tag
    assert client.delete(f"/api/questions/{q1}", headers=headers).status_code == 200
    zero = client.get(path, headers=headers).json()["data"]
    assert zero == {**tag, "question_count": 0}
    assert client.get("/api/tags/99999", headers=headers).status_code == 404
    assert client.get(path).status_code == 401
    assert client.post(
        f"/api/questions/{q2}/tags", json={"tag_ids": [99999]}, headers=headers,
    ).status_code == 400


def test_contract_smoke_user_questions(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "C6")
    headers = _auth(ctx["teacher_token"])
    asker_id = db_session.query(User.id).filter(User.username == "a_C6").scalar()
    q1 = _ask(client, ctx["asker_token"], ctx["course_id"], "旧问题", "内容")
    q2 = _ask(client, ctx["asker_token"], ctx["course_id"], "新问题", "内容")
    _ask(client, ctx["teacher_token"], ctx["course_id"], "他人问题", "内容")
    assert client.post(
        "/api/votes", json={"target_type": "question", "target_id": q2, "value": 1},
        headers=headers,
    ).status_code == 200
    path = f"/api/users/{asker_id}/questions"
    data = client.get(path, params={"page_size": 1}, headers=headers).json()["data"]
    assert data["total"] == 2 and data["page"] == 1 and data["page_size"] == 1
    assert data["items"][0]["id"] == q2 and data["items"][0]["my_vote"] == 1
    assert data["items"][0]["course_name"] == "课程C6"
    second = client.get(path, params={"page": 2, "page_size": 1}, headers=headers)
    assert second.json()["data"]["items"][0]["id"] == q1
    assert client.delete(
        f"/api/questions/{q2}", headers=_auth(ctx["asker_token"])
    ).status_code == 200
    assert client.get(path, headers=headers).json()["data"]["total"] == 1


def test_contract_smoke_user_answers(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "C7")
    headers = _auth(ctx["teacher_token"])
    teacher_id = db_session.query(User.id).filter(User.username == "t_C7").scalar()
    q1 = _ask(client, ctx["asker_token"], ctx["course_id"], "父问题一", "内容")
    q2 = _ask(client, ctx["asker_token"], ctx["course_id"], "父问题二", "内容")
    answer_ids = []
    for question_id in [q1, q2]:
        answer = client.post(
            f"/api/questions/{question_id}/answers", json={"body": "教师解答"}, headers=headers,
        )
        assert answer.status_code == 200
        answer_ids.append(answer.json()["data"]["id"])
    assert client.post(
        f"/api/answers/{answer_ids[0]}/accept", headers=_auth(ctx["asker_token"]),
    ).status_code == 200
    path = f"/api/users/{teacher_id}/answers"
    data = client.get(path, params={"page_size": 1}, headers=headers).json()["data"]
    assert data["total"] == 2 and data["page_size"] == 1 and data["page"] == 1
    assert data["items"][0]["id"] == answer_ids[1]
    assert data["items"][0]["question_title"] == "父问题二"
    assert data["items"][0]["is_accepted"] is False
    second = client.get(path, params={"page": 2, "page_size": 1}, headers=headers).json()["data"]
    assert second["items"][0]["id"] == answer_ids[0]
    assert second["items"][0]["is_accepted"] is True
    assert client.delete(
        f"/api/questions/{q2}", headers=_auth(ctx["asker_token"])
    ).status_code == 200
    assert client.get(path, headers=headers).json()["data"]["total"] == 1
    assert client.delete(f"/api/answers/{answer_ids[0]}", headers=headers).status_code == 200
    assert client.get(path, headers=headers).json()["data"]["items"] == []


def test_contract_smoke_read_boundaries(client: TestClient, db_session: Session) -> None:
    ctx = _setup(client, db_session, "C8")
    empty_user = _create_user(db_session, "empty_C8")
    headers = _auth(ctx["asker_token"])
    for suffix in ["questions", "answers"]:
        path = f"/api/users/{empty_user.id}/{suffix}"
        assert client.get(path, headers=headers).json()["data"] == {
            "items": [], "total": 0, "page": 1, "page_size": 20,
        }
        assert client.get(path).status_code == 401
        assert client.get(f"/api/users/99999/{suffix}", headers=headers).status_code == 404
        for params in [{"page": 0}, {"page_size": 0}, {"page_size": 101}]:
            assert client.get(path, params=params, headers=headers).status_code == 400
    assert client.get("/api/courses", params={"mine": True}).status_code == 401
    assert client.get(
        "/api/courses", params={"mine": True, "page_size": 101}, headers=headers,
    ).status_code == 400
