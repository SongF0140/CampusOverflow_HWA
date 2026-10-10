# qa 标签模块测试：发布绑标签/增量绑定/标签列表与热门/tag_id 筛选、E-03/E-09（T-07）
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.modules.identity.models import User
from app.modules.qa import domain
from app.modules.qa.models import Tag


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
    """测试辅助：教师建课 + 学生提问，返回各 token 与课程/问题 id。"""
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
    return {
        "teacher_token": teacher_token,
        "asker_token": asker_token,
        "other_token": other_token,
        "course_id": course_id,
        "question_id": question_id,
    }


def _bind(client: TestClient, token: str, question_id: int, tag_ids: list):
    """测试辅助：调用绑定标签接口。"""
    return client.post(
        f"/api/questions/{question_id}/tags",
        json={"tag_ids": tag_ids},
        headers=_auth(token),
    )


def _seed_tags(client: TestClient, token: str, question_id: int, names: list) -> dict:
    """测试辅助：经绑定接口内联创建标签，返回 { 名称: id }（模拟"已有标签"）。"""
    resp = _bind(client, token, question_id, names)
    assert resp.status_code == 200
    return {t["name"]: t["id"] for t in resp.json()["data"]["tags"]}


# ---------- domain 纯规则（零框架依赖） ----------


def test_domain_rejects_duplicate_in_request():
    """E-03：同一请求内重复 id 直接拒绝。"""
    with pytest.raises(domain.TagAlreadyBoundError):
        domain.ensure_not_already_bound([], [1, 2, 1])


def test_domain_rejects_duplicate_against_bound():
    """E-03：与既有绑定重复拒绝。"""
    with pytest.raises(domain.TagAlreadyBoundError):
        domain.ensure_not_already_bound([1, 2], [3, 2])


def test_domain_tag_count_limit_and_name_rules():
    """上限 5 拒绝；空名 400；超长名截断至 50。"""
    with pytest.raises(domain.TagLimitExceededError):
        domain.ensure_tag_count_within_limit(3, 3)
    with pytest.raises(domain.TagNameInvalidError):
        domain.normalize_tag_name("   ")
    assert domain.normalize_tag_name(" 机器学习 ") == "机器学习"
    assert len(domain.normalize_tag_name("超" * 60)) == domain.TAG_NAME_MAX_LEN


# ---------- 发布带标签（US-03 / E-03 / E-09） ----------


def test_publish_with_tag_ids_binds(client: TestClient, db_session: Session):
    """发布带 tag_ids：绑定成功且详情回显；未知 id 400；同请求重复 400（E-03）；超 5 个 400。"""
    s = _setup(client, db_session, "tg1")
    ids = _seed_tags(client, s["asker_token"], s["question_id"], ["机器学习", "算法"])
    q2 = client.post(
        "/api/questions",
        json={"title": "t2", "body": "b", "course_id": s["course_id"]},
        headers=_auth(s["asker_token"]),
    ).json()["data"]["id"]
    ids.update(_seed_tags(client, s["asker_token"], q2, ["甲", "乙", "丙", "丁"]))
    six_ids = list(ids.values())
    unknown = client.post(
        "/api/questions",
        json={"title": "t", "body": "b", "course_id": s["course_id"], "tag_ids": [99999]},
        headers=_auth(s["asker_token"]),
    )
    duplicate = client.post(
        "/api/questions",
        json={
            "title": "t", "body": "b", "course_id": s["course_id"],
            "tag_ids": [ids["机器学习"], ids["算法"], ids["机器学习"]],
        },
        headers=_auth(s["asker_token"]),
    )
    over_limit = client.post(
        "/api/questions",
        json={
            "title": "t", "body": "b", "course_id": s["course_id"],
            "tag_ids": six_ids,
        },
        headers=_auth(s["asker_token"]),
    )
    ok_resp = client.post(
        "/api/questions",
        json={
            "title": "带标签的问题", "body": "正文。", "course_id": s["course_id"],
            "tag_ids": [ids["机器学习"]],
        },
        headers=_auth(s["asker_token"]),
    )
    assert unknown.status_code == 400
    assert duplicate.status_code == 400
    assert over_limit.status_code == 400
    assert ok_resp.status_code == 200
    detail = client.get(
        f"/api/questions/{ok_resp.json()['data']['id']}", headers=_auth(s["asker_token"])
    ).json()["data"]
    assert [t["name"] for t in detail["tags"]] == ["机器学习"]


def test_publish_without_tags_writes_nothing(client: TestClient, db_session: Session):
    """E-09 行为锁定：发布不带 tag_ids 不产生任何绑定行，无自动写入路径。"""
    s = _setup(client, db_session, "tg2")
    detail = client.get(
        f"/api/questions/{s['question_id']}", headers=_auth(s["asker_token"])
    ).json()["data"]
    assert detail["tags"] == []
    assert db_session.query(Tag).count() == 0


# ---------- 增量绑定接口（US-03 / E-03） ----------


def test_bind_with_inline_custom_name_and_reuse(client: TestClient, db_session: Session):
    """绑定：内联自定义名创建；详情与列表回填 tags；同名跨问题复用同一标签。"""
    s = _setup(client, db_session, "tg3")
    ids = _seed_tags(client, s["asker_token"], s["question_id"], ["机器学习"])
    resp = _bind(client, s["asker_token"], s["question_id"], ["深度学习"])
    assert resp.status_code == 200
    tags = resp.json()["data"]["tags"]
    assert [t["name"] for t in tags] == ["机器学习", "深度学习"]
    assert {t["type"] for t in tags} == {"custom"}
    assert client.get(
        f"/api/questions/{s['question_id']}", headers=_auth(s["asker_token"])
    ).json()["data"]["tags"] == tags
    items = client.get("/api/questions", headers=_auth(s["asker_token"])).json()["data"]["items"]
    target = next(i for i in items if i["id"] == s["question_id"])
    assert [t["name"] for t in target["tags"]] == ["机器学习", "深度学习"]
    q2 = client.post(
        "/api/questions",
        json={"title": "t2", "body": "b", "course_id": s["course_id"]},
        headers=_auth(s["asker_token"]),
    ).json()["data"]["id"]
    resp2 = _bind(client, s["asker_token"], q2, ["机器学习"])
    assert resp2.status_code == 200
    assert resp2.json()["data"]["tags"][0]["id"] == ids["机器学习"]
    assert db_session.query(Tag).count() == 2


def test_bind_duplicate_rejected(client: TestClient, db_session: Session):
    """E-03：与既有绑定重复 400；同请求内重复名同样 400。"""
    s = _setup(client, db_session, "tg4")
    ids = _seed_tags(client, s["asker_token"], s["question_id"], ["机器学习"])
    dup_bound = _bind(client, s["asker_token"], s["question_id"], [ids["机器学习"]])
    dup_in_req = _bind(client, s["asker_token"], s["question_id"], ["算法", "算法"])
    assert dup_bound.status_code == 400
    assert "重复绑定" in dup_bound.json()["message"]
    assert dup_in_req.status_code == 400


def test_bind_permission_and_visibility(client: TestClient, db_session: Session):
    """绑定：非作者 403；问题不存在 404；未登录 401。"""
    s = _setup(client, db_session, "tg5")
    assert _bind(client, s["other_token"], s["question_id"], ["机器学习"]).status_code == 403
    assert _bind(client, s["asker_token"], 99999, ["机器学习"]).status_code == 404
    assert client.post(
        f"/api/questions/{s['question_id']}/tags", json={"tag_ids": ["机器学习"]}
    ).status_code == 401


def test_bind_exceeds_total_limit(client: TestClient, db_session: Session):
    """每问题标签总数上限 5（T-07 定案）：已绑 3 再增 3 → 400。"""
    s = _setup(client, db_session, "tg6")
    _seed_tags(client, s["asker_token"], s["question_id"], ["a", "b", "c"])
    resp = _bind(client, s["asker_token"], s["question_id"], ["d", "e", "f"])
    assert resp.status_code == 400


def test_bind_truncated_long_name(client: TestClient, db_session: Session):
    """E-02 同思路：超长标签名截断至 50 字入库。"""
    s = _setup(client, db_session, "tg7")
    resp = _bind(client, s["asker_token"], s["question_id"], ["超" * 60])
    assert resp.status_code == 200
    assert len(resp.json()["data"]["tags"][0]["name"]) == domain.TAG_NAME_MAX_LEN


def test_bind_blank_name_rejected(client: TestClient, db_session: Session):
    """空标签名（剥离空白后）400。"""
    s = _setup(client, db_session, "tg8")
    assert _bind(client, s["asker_token"], s["question_id"], ["   "]).status_code == 400


# ---------- 标签列表（US-03：keyword / hot / question_count） ----------


def test_tags_list_requires_login(client: TestClient, db_session: Session):
    assert client.get("/api/tags").status_code == 401


def test_tags_list_keyword_and_count(client: TestClient, db_session: Session):
    """keyword 模糊筛名；question_count 只统计未软删问题（E-10）。"""
    s = _setup(client, db_session, "tg9")
    _seed_tags(client, s["asker_token"], s["question_id"], ["机器学习", "机器视觉"])
    items = client.get(
        "/api/tags", params={"keyword": "机器"}, headers=_auth(s["asker_token"])
    ).json()["data"]["items"]
    assert {t["name"] for t in items} == {"机器学习", "机器视觉"}
    assert all(t["question_count"] == 1 for t in items)
    assert all(t["type"] == "custom" for t in items)
    client.delete(
        f"/api/questions/{s['question_id']}", headers=_auth(s["asker_token"])
    )
    items = client.get(
        "/api/tags", params={"keyword": "机器"}, headers=_auth(s["asker_token"])
    ).json()["data"]["items"]
    assert all(t["question_count"] == 0 for t in items)


def test_tags_hot_sorted_and_excludes_unused(client: TestClient, db_session: Session):
    """hot=true：按绑定数降序、只含有绑定的标签；unused 零绑定标签不出现。"""
    s = _setup(client, db_session, "tg10")
    ids = _seed_tags(client, s["asker_token"], s["question_id"], ["冷门", "热门"])
    second = client.post(
        "/api/questions",
        json={"title": "t2", "body": "b", "course_id": s["course_id"], "tag_ids": [ids["热门"]]},
        headers=_auth(s["asker_token"]),
    ).json()["data"]["id"]
    _bind(client, s["asker_token"], second, ["更热"])
    items = client.get(
        "/api/tags", params={"hot": "true"}, headers=_auth(s["asker_token"])
    ).json()["data"]["items"]
    assert [t["name"] for t in items] == ["热门", "冷门", "更热"]
    assert items[0]["question_count"] == 2


def test_list_questions_filter_by_tag_id(client: TestClient, db_session: Session):
    """tag_id 筛选：只返回绑定了该标签的可见问题。"""
    s = _setup(client, db_session, "tg11")
    ids = _seed_tags(client, s["asker_token"], s["question_id"], ["机器学习"])
    q2 = client.post(
        "/api/questions",
        json={"title": "无关问题", "body": "b", "course_id": s["course_id"]},
        headers=_auth(s["asker_token"]),
    ).json()["data"]["id"]
    items = client.get(
        f"/api/questions?tag_id={ids['机器学习']}", headers=_auth(s["asker_token"])
    ).json()["data"]["items"]
    assert [i["id"] for i in items] == [s["question_id"]]
    assert items[0]["tags"][0]["name"] == "机器学习"
    assert q2 not in [i["id"] for i in items]
