# qa 回答与采纳模块测试：发布/编辑/软删除、采纳 E-05/E-06、助教推荐 E-12/E-13、教师认证 D9（T-05）
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.modules.identity.models import User


def _create_user(db: Session, username: str, role: str = "student", **extra) -> User:
    """测试辅助：直接在数据库创建用户（extra 传身份类型与助教认证字段）。"""
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


def _setup_question(client: TestClient, db: Session, code: str) -> dict:
    """测试辅助：教师建课 + 学生加入并提问，返回教师/学生/提问者 token 与问题 id。"""
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
    answerer_token = _login(client, f"u_{code}")
    return {
        "teacher_token": teacher_token,
        "asker_token": asker_token,
        "answerer_token": answerer_token,
        "course_id": course_id,
        "question_id": question_id,
    }


def _answer(client: TestClient, token: str, question_id: int, body: str = "我的解答。"):
    """测试辅助：发布回答。"""
    return client.post(
        f"/api/questions/{question_id}/answers", json={"body": body}, headers=_auth(token)
    )


def _accept(client: TestClient, token: str, answer_id: int):
    return client.post(f"/api/answers/{answer_id}/accept", headers=_auth(token))


def _make_assistant(db: Session, client: TestClient, username: str) -> str:
    """测试辅助：创建研究生且助教认证通过的用户，返回 token。"""
    _create_user(
        db,
        username,
        identity_type="postgraduate",
        assistant_cert_status="approved",
    )
    return _login(client, username)


# ---------- 发布回答（US-04）----------


def test_publish_answer_success(client: TestClient, db_session: Session) -> None:
    """登录用户回答可见问题成功。"""
    ctx = _setup_question(client, db_session, "AN101")
    resp = _answer(client, ctx["answerer_token"], ctx["question_id"])
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "published"
    assert resp.json()["message"] == "回答成功"


def test_publish_answer_question_not_found(client: TestClient, db_session: Session) -> None:
    """回答不存在的问题 404。"""
    ctx = _setup_question(client, db_session, "AN102")
    resp = _answer(client, ctx["answerer_token"], 99999)
    assert resp.status_code == 404


def test_publish_answer_on_deleted_question_404(
    client: TestClient, db_session: Session
) -> None:
    """软删问题不可再回答（E-10）。"""
    ctx = _setup_question(client, db_session, "AN103")
    client.delete(
        f"/api/questions/{ctx['question_id']}", headers=_auth(ctx["asker_token"])
    )
    resp = _answer(client, ctx["answerer_token"], ctx["question_id"])
    assert resp.status_code == 404


def test_publish_answer_blank_body_400(client: TestClient, db_session: Session) -> None:
    """空白正文拒绝提交（E-01）。"""
    ctx = _setup_question(client, db_session, "AN104")
    resp = _answer(client, ctx["answerer_token"], ctx["question_id"], "   ")
    assert resp.status_code == 400


def test_publish_answer_unauthenticated_401(
    client: TestClient, db_session: Session
) -> None:
    """未登录回答 401。"""
    ctx = _setup_question(client, db_session, "AN105")
    resp = client.post(
        f"/api/questions/{ctx['question_id']}/answers", json={"body": "匿名回答"}
    )
    assert resp.status_code == 401


def test_publish_answer_sanitizes_script(client: TestClient, db_session: Session) -> None:
    """脚本内容被清洗后正常入库，不报错（X-03）。"""
    ctx = _setup_question(client, db_session, "AN106")
    resp = _answer(
        client, ctx["answerer_token"], ctx["question_id"], "<script>alert(1)</script>正常内容"
    )
    assert resp.status_code == 200
    detail_id = resp.json()["data"]["id"]
    items = client.get(
        f"/api/questions/{ctx['question_id']}/answers", headers=_auth(ctx["asker_token"])
    ).json()["data"]["items"]
    target = next(a for a in items if a["id"] == detail_id)
    assert "<script>" not in target["body"]
    assert "正常内容" in target["body"]


def test_publish_answer_truncates_long_body(
    client: TestClient, db_session: Session
) -> None:
    """正文超过 20000 字截断并在 message 提示（E-02）。"""
    ctx = _setup_question(client, db_session, "AN107")
    resp = _answer(client, ctx["answerer_token"], ctx["question_id"], "字" * 20001)
    assert resp.status_code == 200
    assert "截断" in resp.json()["message"]


# ---------- 回答列表（US-04）----------


def test_list_answers_basic_and_deleted_hidden(
    client: TestClient, db_session: Session
) -> None:
    """回答列表含作者名；软删回答不可见（E-10）。"""
    ctx = _setup_question(client, db_session, "AN108")
    r1 = _answer(client, ctx["answerer_token"], ctx["question_id"], "第一条")
    _answer(client, ctx["asker_token"], ctx["question_id"], "第二条")
    client.delete(
        f"/api/answers/{r1.json()['data']['id']}", headers=_auth(ctx["answerer_token"])
    )
    resp = client.get(
        f"/api/questions/{ctx['question_id']}/answers", headers=_auth(ctx["teacher_token"])
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1
    assert data["items"][0]["author"] == "a_AN108"
    assert data["items"][0]["body"] == "第二条"


def test_list_answers_question_not_found(client: TestClient, db_session: Session) -> None:
    """问题不存在时回答列表 404。"""
    ctx = _setup_question(client, db_session, "AN109")
    resp = client.get(
        "/api/questions/99999/answers", headers=_auth(ctx["answerer_token"])
    )
    assert resp.status_code == 404


def test_list_answers_invalid_sort_400(client: TestClient, db_session: Session) -> None:
    """非法 sort 值 400。"""
    ctx = _setup_question(client, db_session, "AN110")
    resp = client.get(
        f"/api/questions/{ctx['question_id']}/answers?sort=abc",
        headers=_auth(ctx["answerer_token"]),
    )
    assert resp.status_code == 400


def test_list_answers_accepted_sort_top(client: TestClient, db_session: Session) -> None:
    """sort=accepted 时被采纳回答置顶突出展示（US-06）。"""
    ctx = _setup_question(client, db_session, "AN111")
    first = _answer(client, ctx["answerer_token"], ctx["question_id"], "早的回答")
    _answer(client, ctx["asker_token"], ctx["question_id"], "晚的回答")
    _accept(client, ctx["asker_token"], first.json()["data"]["id"])
    resp = client.get(
        f"/api/questions/{ctx['question_id']}/answers?sort=accepted",
        headers=_auth(ctx["answerer_token"]),
    )
    items = resp.json()["data"]["items"]
    assert items[0]["body"] == "早的回答"
    assert items[0]["is_accepted"] is True


# ---------- 采纳（US-06、E-05/E-06）----------


def test_accept_by_asker_resolves_question(
    client: TestClient, db_session: Session
) -> None:
    """提问者采纳成功：问题状态 resolved，详情回填 accepted_answer_id。"""
    ctx = _setup_question(client, db_session, "AN112")
    answer_id = _answer(client, ctx["answerer_token"], ctx["question_id"]).json()["data"]["id"]
    resp = _accept(client, ctx["asker_token"], answer_id)
    assert resp.status_code == 200
    assert resp.json()["data"] == {"accepted": True, "question_status": "resolved"}
    detail = client.get(
        f"/api/questions/{ctx['question_id']}", headers=_auth(ctx["asker_token"])
    ).json()["data"]
    assert detail["status"] == "resolved"
    assert detail["accepted_answer_id"] == answer_id


def test_accept_by_other_403(client: TestClient, db_session: Session) -> None:
    """非提问者采纳 403（E-06）。"""
    ctx = _setup_question(client, db_session, "AN113")
    answer_id = _answer(client, ctx["answerer_token"], ctx["question_id"]).json()["data"]["id"]
    resp = _accept(client, ctx["answerer_token"], answer_id)
    assert resp.status_code == 403


def test_accept_twice_400(client: TestClient, db_session: Session) -> None:
    """已有采纳后再采纳 400（E-05）。"""
    ctx = _setup_question(client, db_session, "AN114")
    a1 = _answer(client, ctx["answerer_token"], ctx["question_id"], "第一答").json()["data"]["id"]
    a2 = _answer(client, ctx["asker_token"], ctx["question_id"], "第二答").json()["data"]["id"]
    assert _accept(client, ctx["asker_token"], a1).status_code == 200
    resp = _accept(client, ctx["asker_token"], a2)
    assert resp.status_code == 400


def test_accept_deleted_answer_404(client: TestClient, db_session: Session) -> None:
    """软删回答不可被采纳（E-10）。"""
    ctx = _setup_question(client, db_session, "AN115")
    answer_id = _answer(client, ctx["answerer_token"], ctx["question_id"]).json()["data"]["id"]
    client.delete(f"/api/answers/{answer_id}", headers=_auth(ctx["answerer_token"]))
    resp = _accept(client, ctx["asker_token"], answer_id)
    assert resp.status_code == 404


def test_delete_accepted_answer_unaccepts_question(
    client: TestClient, db_session: Session
) -> None:
    """删除已采纳回答：问题撤销采纳并回退 published，无悬空引用。"""
    ctx = _setup_question(client, db_session, "AN116")
    answer_id = _answer(client, ctx["answerer_token"], ctx["question_id"]).json()["data"]["id"]
    _accept(client, ctx["asker_token"], answer_id)
    resp = client.delete(f"/api/answers/{answer_id}", headers=_auth(ctx["answerer_token"]))
    assert resp.status_code == 200
    detail = client.get(
        f"/api/questions/{ctx['question_id']}", headers=_auth(ctx["asker_token"])
    ).json()["data"]
    assert detail["accepted_answer_id"] is None
    assert detail["status"] == "published"


# ---------- 回答编辑与删除（US-04、E-10）----------


def test_update_answer_by_author_only(client: TestClient, db_session: Session) -> None:
    """仅作者可编辑回答；非作者 403；空白正文 400（E-01）。"""
    ctx = _setup_question(client, db_session, "AN117")
    answer_id = _answer(
        client, ctx["answerer_token"], ctx["question_id"], "初稿"
    ).json()["data"]["id"]
    assert (
        client.patch(
            f"/api/answers/{answer_id}",
            json={"body": "<b>修订稿</b>"},
            headers=_auth(ctx["asker_token"]),
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/answers/{answer_id}",
            json={"body": "  "},
            headers=_auth(ctx["answerer_token"]),
        ).status_code
        == 400
    )
    resp = client.patch(
        f"/api/answers/{answer_id}",
        json={"body": "<b>修订稿</b>"},
        headers=_auth(ctx["answerer_token"]),
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["body"] == "修订稿"  # HTML 标签被剥离（X-03）


def test_delete_answer_permissions(client: TestClient, db_session: Session) -> None:
    """作者可删自己的回答；普通用户删他人 403；管理员可删他人（E-10）。"""
    ctx = _setup_question(client, db_session, "AN118")
    a1 = _answer(client, ctx["answerer_token"], ctx["question_id"], "A").json()["data"]["id"]
    a2 = _answer(client, ctx["asker_token"], ctx["question_id"], "B").json()["data"]["id"]
    _create_user(db_session, "admin_AN118", role="admin")
    admin_token = _login(client, "admin_AN118")
    _create_user(db_session, "out_AN118")
    outsider_token = _login(client, "out_AN118")
    assert (
        client.delete(f"/api/answers/{a1}", headers=_auth(outsider_token)).status_code
        == 403
    )
    assert (
        client.delete(f"/api/answers/{a2}", headers=_auth(admin_token)).status_code == 200
    )
    assert (
        client.delete(f"/api/answers/{a1}", headers=_auth(ctx["answerer_token"])).status_code
        == 200
    )


def test_question_list_fills_answer_count(
    client: TestClient, db_session: Session
) -> None:
    """问题列表回填 answer_count/has_accepted（T-04 占位回填）。"""
    ctx = _setup_question(client, db_session, "AN119")
    _answer(client, ctx["answerer_token"], ctx["question_id"], "一答")
    a2 = _answer(client, ctx["asker_token"], ctx["question_id"], "二答").json()["data"]["id"]
    _accept(client, ctx["asker_token"], a2)
    items = client.get(
        "/api/questions", headers=_auth(ctx["answerer_token"])
    ).json()["data"]["items"]
    target = next(q for q in items if q["id"] == ctx["question_id"])
    assert target["answer_count"] == 2
    assert target["has_accepted"] is True


# ---------- 助教推荐标记（US-20、E-12/E-13）----------


def test_recommend_by_graduate_assistant(client: TestClient, db_session: Session) -> None:
    """助教标记与取消推荐；本科生与未认证研究生 403（E-12）。"""
    ctx = _setup_question(client, db_session, "AN120")
    answer_id = _answer(client, ctx["answerer_token"], ctx["question_id"]).json()["data"]["id"]
    assistant_token = _make_assistant(db_session, client, "ga_AN120")
    ok_resp = client.post(
        f"/api/answers/{answer_id}/recommend",
        json={"recommended": True},
        headers=_auth(assistant_token),
    )
    assert ok_resp.status_code == 200
    assert ok_resp.json()["data"]["recommended_by_assistant"] is True
    _create_user(db_session, "ug_AN120")
    undergrad_token = _login(client, "ug_AN120")
    assert (
        client.post(
            f"/api/answers/{answer_id}/recommend",
            json={"recommended": True},
            headers=_auth(undergrad_token),
        ).status_code
        == 403
    )
    _create_user(
        db_session,
        "pg_AN120",
        identity_type="postgraduate",
        assistant_cert_status="pending",
    )
    pending_token = _login(client, "pg_AN120")
    assert (
        client.post(
            f"/api/answers/{answer_id}/recommend",
            json={"recommended": True},
            headers=_auth(pending_token),
        ).status_code
        == 403
    )
    cancel = client.post(
        f"/api/answers/{answer_id}/recommend",
        json={"recommended": False},
        headers=_auth(assistant_token),
    )
    assert cancel.json()["data"]["recommended_by_assistant"] is False


def test_recommend_does_not_affect_accept(
    client: TestClient, db_session: Session
) -> None:
    """推荐仅为展示标记：不影响提问者采纳权与问题状态（E-13）。"""
    ctx = _setup_question(client, db_session, "AN121")
    answer_id = _answer(client, ctx["answerer_token"], ctx["question_id"]).json()["data"]["id"]
    assistant_token = _make_assistant(db_session, client, "ga_AN121")
    client.post(
        f"/api/answers/{answer_id}/recommend",
        json={"recommended": True},
        headers=_auth(assistant_token),
    )
    resp = _accept(client, ctx["asker_token"], answer_id)
    assert resp.status_code == 200
    assert resp.json()["data"]["question_status"] == "resolved"


# ---------- 教师优质内容认证（D9 定案）----------


def test_certify_by_course_teacher(client: TestClient, db_session: Session) -> None:
    """负责教师置位与取消认证；非任教教师与管理员 403（E-06/D9）。"""
    ctx = _setup_question(client, db_session, "AN122")
    answer_id = _answer(client, ctx["answerer_token"], ctx["question_id"]).json()["data"]["id"]
    put = client.post(
        f"/api/answers/{answer_id}/certify", headers=_auth(ctx["teacher_token"])
    )
    assert put.status_code == 200
    assert put.json()["data"]["certified_by_teacher"] is True
    _create_user(db_session, "t2_AN122", role="teacher")
    other_teacher_token = _login(client, "t2_AN122")
    assert (
        client.post(
            f"/api/answers/{answer_id}/certify", headers=_auth(other_teacher_token)
        ).status_code
        == 403
    )
    _create_user(db_session, "admin_AN122", role="admin")
    admin_token = _login(client, "admin_AN122")
    assert (
        client.post(
            f"/api/answers/{answer_id}/certify", headers=_auth(admin_token)
        ).status_code
        == 403
    )
    cancel = client.delete(
        f"/api/answers/{answer_id}/certify", headers=_auth(ctx["teacher_token"])
    )
    assert cancel.json()["data"]["certified_by_teacher"] is False


# ---------- 评审回归：空 PATCH 无操作（E-01 不误伤）、父问题软删后的回答操作边界（E-10） ----------


def test_patch_answer_empty_body_is_noop(client: TestClient, db_session: Session) -> None:
    """空 PATCH 对象（无字段）按"不修改"返回 200 且正文不变；显式空白正文仍 400（E-01）。"""
    ctx = _setup_question(client, db_session, "AN201")
    answer_id = _answer(client, ctx["answerer_token"], ctx["question_id"]).json()["data"]["id"]
    noop = client.patch(
        f"/api/answers/{answer_id}", json={}, headers=_auth(ctx["answerer_token"])
    )
    assert noop.status_code == 200
    assert noop.json()["data"]["body"] == "我的解答。"
    assert noop.json()["message"] == "回答成功"
    blank = client.patch(
        f"/api/answers/{answer_id}", json={"body": "   "}, headers=_auth(ctx["answerer_token"])
    )
    assert blank.status_code == 400


def test_answer_ops_blocked_when_parent_question_deleted(
    client: TestClient, db_session: Session
) -> None:
    """父问题软删后：编辑/推荐/认证/评论一律 404；投票按 E-10 放行；删除仅减可见性仍放行。"""
    ctx = _setup_question(client, db_session, "AN202")
    assistant_token = _make_assistant(db_session, client, "ga_AN202")
    answer_id = _answer(client, ctx["answerer_token"], ctx["question_id"]).json()["data"]["id"]
    client.post(f"/api/answers/{answer_id}/certify", headers=_auth(ctx["teacher_token"]))
    # 作者软删父问题
    assert client.delete(
        f"/api/questions/{ctx['question_id']}", headers=_auth(ctx["asker_token"])
    ).status_code == 200
    assert client.patch(
        f"/api/answers/{answer_id}", json={"body": "改"},
        headers=_auth(ctx["answerer_token"]),
    ).status_code == 404
    assert client.post(
        f"/api/answers/{answer_id}/recommend", json={"recommended": True},
        headers=_auth(assistant_token),
    ).status_code == 404
    assert client.post(
        f"/api/answers/{answer_id}/certify", headers=_auth(ctx["teacher_token"])
    ).status_code == 404
    assert client.post(
        f"/api/answers/{answer_id}/comments", json={"body": "评论"},
        headers=_auth(ctx["asker_token"]),
    ).status_code == 404
    assert client.get(
        f"/api/answers/{answer_id}/comments", headers=_auth(ctx["asker_token"])
    ).status_code == 404
    # 规格 E-10：回答投票仅检查回答自身软删，不受父问题软删限制
    vote = client.post(
        "/api/votes",
        json={"target_type": "answer", "target_id": answer_id, "value": 1},
        headers=_auth(ctx["asker_token"]),
    )
    assert vote.status_code == 200
    # 删除只减可见性且承担已采纳清理职责，仍放行
    assert client.delete(
        f"/api/answers/{answer_id}", headers=_auth(ctx["answerer_token"])
    ).status_code == 200
