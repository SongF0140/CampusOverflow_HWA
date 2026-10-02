# interaction 投票与声誉测试：E-04 toggle 状态机、积分流水、榜单、采纳 +15 与排序回填（T-08）
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.modules.identity.models import User
from app.modules.interaction.models import AnswerVote, QuestionVote, ReputationLog


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
    """测试辅助：教师建课 + 学生提问 + 他人回答，返回各 token 与 id。"""
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


def _vote(client: TestClient, token: str, target_type: str, target_id: int, value: int):
    return client.post(
        "/api/votes",
        json={"target_type": target_type, "target_id": target_id, "value": value},
        headers=_auth(token),
    )


def _reputation_of(db: Session, username: str) -> int:
    return (
        db.query(User).filter(User.username == username).first().reputation_score
    )


# ---------- 投票 toggle 状态机（US-07/E-04） ----------


def test_vote_question_up_ok(client: TestClient, db_session: Session) -> None:
    """问题点赞成功：回包 vote_score/my_vote=1，message 中文。"""
    ctx = _setup(client, db_session, "V1")
    resp = _vote(client, ctx["other_token"], "question", ctx["question_id"], 1)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["vote_score"] == 1 and data["my_vote"] == 1
    assert resp.json()["message"] == "投票成功"


def test_toggle_same_direction_cancels(client: TestClient, db_session: Session) -> None:
    """E-04 toggle：重复同方向=取消（删行），票分与我的票向归零。"""
    ctx = _setup(client, db_session, "V2")
    _vote(client, ctx["other_token"], "question", ctx["question_id"], 1)
    resp = _vote(client, ctx["other_token"], "question", ctx["question_id"], 1)
    data = resp.json()["data"]
    assert data["vote_score"] == 0 and data["my_vote"] == 0
    assert db_session.query(QuestionVote).count() == 0


def test_switch_vote_keeps_single_row(client: TestClient, db_session: Session) -> None:
    """E-04 改票：赞改踩后仅一行、票向为 -1、票分为 -1。"""
    ctx = _setup(client, db_session, "V3")
    _vote(client, ctx["other_token"], "answer", ctx["answer_id"], 1)
    resp = _vote(client, ctx["other_token"], "answer", ctx["answer_id"], -1)
    data = resp.json()["data"]
    assert data["vote_score"] == -1 and data["my_vote"] == -1
    assert db_session.query(AnswerVote).count() == 1


def test_vote_invalid_value_400(client: TestClient, db_session: Session) -> None:
    """value 非 ±1 → 400。"""
    ctx = _setup(client, db_session, "V4")
    resp = _vote(client, ctx["other_token"], "question", ctx["question_id"], 0)
    assert resp.status_code == 400


def test_vote_invalid_target_type_400(client: TestClient, db_session: Session) -> None:
    """target_type 非 question/answer → 400。"""
    ctx = _setup(client, db_session, "V5")
    resp = _vote(client, ctx["other_token"], "comment", 1, 1)
    assert resp.status_code == 400


def test_vote_missing_target_404(client: TestClient, db_session: Session) -> None:
    """目标不存在 → 404。"""
    ctx = _setup(client, db_session, "V6")
    resp = _vote(client, ctx["other_token"], "question", 99999, 1)
    assert resp.status_code == 404


def test_vote_deleted_target_404(client: TestClient, db_session: Session) -> None:
    """软删内容不可投（E-10 同口径）→ 404。"""
    ctx = _setup(client, db_session, "V7")
    client.delete(
        f"/api/questions/{ctx['question_id']}", headers=_auth(ctx["asker_token"])
    )
    resp = _vote(client, ctx["other_token"], "question", ctx["question_id"], 1)
    assert resp.status_code == 404


def test_vote_unauthenticated_401(client: TestClient, db_session: Session) -> None:
    """未登录投票 → 401。"""
    ctx = _setup(client, db_session, "V8")
    resp = client.post(
        "/api/votes",
        json={"target_type": "question", "target_id": ctx["question_id"], "value": 1},
    )
    assert resp.status_code == 401


def test_banned_user_cannot_vote_403(client: TestClient, db_session: Session) -> None:
    """E-07：封禁用户投票 403（get_current_user 统一拦截，旧 token 时序同 T-06）。"""
    ctx = _setup(client, db_session, "V9")
    user = _create_user(db_session, "banned_v9")
    token = _login(client, "banned_v9")
    user.status = "banned"
    db_session.commit()
    resp = _vote(client, token, "question", ctx["question_id"], 1)
    assert resp.status_code == 403


# ---------- 领域纯规则（零框架单测） ----------


def test_domain_next_vote_action_matrix() -> None:
    """toggle 状态机：无票 create / 同向 cancel / 反向 switch。"""
    from app.modules.interaction import domain

    assert domain.next_vote_action(None, 1) == "create"
    assert domain.next_vote_action(1, 1) == "cancel"
    assert domain.next_vote_action(-1, -1) == "cancel"
    assert domain.next_vote_action(1, -1) == "switch"
    assert domain.next_vote_action(-1, 1) == "switch"


def test_domain_reputation_rules() -> None:
    """积分表：回答赞 +10、任何内容踩 -2、问题赞 0；冲销恒为取反。"""
    from app.modules.interaction import domain

    assert domain.reputation_delta_for_vote("answer", 1) == 10
    assert domain.reputation_delta_for_vote("question", 1) == 0
    assert domain.reputation_delta_for_vote("answer", -1) == -2
    assert domain.reputation_delta_for_vote("question", -1) == -2
    assert domain.reputation_delta_for_cancel("answer", 1) == -10
    assert domain.reputation_delta_for_cancel("question", -1) == 2
    assert domain.cancel_reason_for(1) == "upvote_cancelled"
    assert domain.cancel_reason_for(-1) == "downvote_cancelled"


# ---------- 声誉积分流水（需求文档 4.7：积分变化必有流水） ----------


def test_answer_upvote_grants_plus10(client: TestClient, db_session: Session) -> None:
    """回答被点赞：作者 +10 且写 answer_upvoted 流水。"""
    ctx = _setup(client, db_session, "R1")
    _vote(client, ctx["asker_token"], "answer", ctx["answer_id"], 1)
    assert _reputation_of(db_session, "u_R1") == 10
    log = (
        db_session.query(ReputationLog)
        .filter(ReputationLog.reason == "answer_upvoted")
        .first()
    )
    assert log is not None and log.delta == 10 and log.ref_type == "answer"


def test_downvote_penalizes_minus2(client: TestClient, db_session: Session) -> None:
    """内容被点踩：作者 -2（问题与回答同规则）且写 content_downvoted 流水。"""
    ctx = _setup(client, db_session, "R2")
    _vote(client, ctx["other_token"], "question", ctx["question_id"], -1)
    assert _reputation_of(db_session, "a_R2") == -2


def test_question_upvote_no_reputation(client: TestClient, db_session: Session) -> None:
    """问题被点赞不计分（需求文档积分表字面：仅"回答被点赞"），无流水。"""
    ctx = _setup(client, db_session, "R3")
    _vote(client, ctx["other_token"], "question", ctx["question_id"], 1)
    assert _reputation_of(db_session, "a_R3") == 0
    assert db_session.query(ReputationLog).count() == 0


def test_cancel_writes_reversal_log(client: TestClient, db_session: Session) -> None:
    """取消点赞：冲销 -10 并写 upvote_cancelled 流水，总分回到 0。"""
    ctx = _setup(client, db_session, "R4")
    _vote(client, ctx["asker_token"], "answer", ctx["answer_id"], 1)
    _vote(client, ctx["asker_token"], "answer", ctx["answer_id"], 1)
    assert _reputation_of(db_session, "u_R4") == 0
    reasons = [r.reason for r in db_session.query(ReputationLog).all()]
    assert reasons == ["answer_upvoted", "upvote_cancelled"]


def test_switch_writes_both_logs(client: TestClient, db_session: Session) -> None:
    """改票：旧票冲销 + 新票生效两条流水（+10 → -10 → -2，总分 -2）。"""
    ctx = _setup(client, db_session, "R5")
    _vote(client, ctx["asker_token"], "answer", ctx["answer_id"], 1)
    _vote(client, ctx["asker_token"], "answer", ctx["answer_id"], -1)
    assert _reputation_of(db_session, "u_R5") == -2
    deltas = [r.delta for r in db_session.query(ReputationLog).all()]
    assert deltas == [10, -10, -2]


# ---------- 声誉查询与榜单（US-08/E-11/Q-04） ----------


def test_my_reputation_returns_score_and_logs(
    client: TestClient, db_session: Session
) -> None:
    """我的积分与流水：score 与流水一致；他人流水不可见（E-11 由"仅本人"入口保证）。"""
    ctx = _setup(client, db_session, "M1")
    _vote(client, ctx["asker_token"], "answer", ctx["answer_id"], 1)
    resp = client.get("/api/reputation/me", headers=_auth(ctx["other_token"]))
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["score"] == 10
    assert data["total"] == 1
    assert data["logs"][0]["reason"] == "answer_upvoted"


def test_public_reputation_without_logs(client: TestClient, db_session: Session) -> None:
    """公开声誉（接口文档 §2）：总分与发帖/回答计数，不含流水（E-11）。"""
    ctx = _setup(client, db_session, "M2")
    _vote(client, ctx["asker_token"], "answer", ctx["answer_id"], 1)
    answerer_id = (
        db_session.query(User).filter(User.username == "u_M2").first().id
    )
    resp = client.get(
        f"/api/users/{answerer_id}/reputation", headers=_auth(ctx["other_token"])
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["reputation_score"] == 10
    assert data["question_count"] == 0 and data["answer_count"] == 1
    assert "logs" not in data


def test_public_reputation_missing_user_404(
    client: TestClient, db_session: Session
) -> None:
    """公开声誉：用户不存在 → 404。"""
    ctx = _setup(client, db_session, "M3")
    resp = client.get("/api/users/99999/reputation", headers=_auth(ctx["other_token"]))
    assert resp.status_code == 404


def test_rank_all_and_week(client: TestClient, db_session: Session) -> None:
    """榜单：all 用总分列；week 聚合窗口流水；条目含用户名与分数。"""
    ctx = _setup(client, db_session, "M4")
    _vote(client, ctx["asker_token"], "answer", ctx["answer_id"], 1)
    resp = client.get(
        "/api/reputation/rank", params={"period": "week"}, headers=_auth(ctx["other_token"])
    )
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["username"] == "u_M4" and items[0]["score"] == 10
    resp_all = client.get(
        "/api/reputation/rank", params={"period": "all"}, headers=_auth(ctx["other_token"])
    )
    assert resp_all.status_code == 200
    assert any(
        i["username"] == "u_M4" and i["score"] == 10
        for i in resp_all.json()["data"]["items"]
    )


def test_rank_invalid_period_400(client: TestClient, db_session: Session) -> None:
    """非法 period → 400（路由 pattern 归一）。"""
    ctx = _setup(client, db_session, "M5")
    resp = client.get(
        "/api/reputation/rank", params={"period": "year"}, headers=_auth(ctx["other_token"])
    )
    assert resp.status_code == 400


def test_rank_course_filter(client: TestClient, db_session: Session) -> None:
    """课程榜：按流水课程快照过滤，其他课程不计入。"""
    ctx = _setup(client, db_session, "M6")
    _vote(client, ctx["asker_token"], "answer", ctx["answer_id"], 1)
    resp = client.get(
        "/api/reputation/rank",
        params={"period": "all", "course_id": ctx["course_id"]},
        headers=_auth(ctx["other_token"]),
    )
    assert resp.status_code == 200
    assert len(resp.json()["data"]["items"]) == 1
    resp_empty = client.get(
        "/api/reputation/rank",
        params={"period": "all", "course_id": ctx["course_id"] + 1000},
        headers=_auth(ctx["other_token"]),
    )
    assert resp_empty.json()["data"]["items"] == []


# ---------- 采纳 +15 与排序回填（架构说明 4.B / 接口文档 §3/§4 预告） ----------


def test_accept_grants_plus15_with_log(client: TestClient, db_session: Session) -> None:
    """采纳事务回填：回答者 +15 且写 accept 流水（与采纳同一事务）。"""
    ctx = _setup(client, db_session, "A1")
    resp = client.post(
        f"/api/answers/{ctx['answer_id']}/accept", headers=_auth(ctx["asker_token"])
    )
    assert resp.status_code == 200
    assert _reputation_of(db_session, "u_A1") == 15
    log = (
        db_session.query(ReputationLog)
        .filter(ReputationLog.reason == "accept")
        .first()
    )
    assert log is not None and log.delta == 15 and log.ref_id == ctx["answer_id"]


def test_hot_sort_by_vote_score(client: TestClient, db_session: Session) -> None:
    """sort=hot 改投票分降序（T-08 起替代浏览数口径），my_vote 同步回填。"""
    ctx = _setup(client, db_session, "S1")
    other_question_id = client.post(
        "/api/questions",
        json={"title": "问题B", "body": "内容", "course_id": ctx["course_id"]},
        headers=_auth(ctx["asker_token"]),
    ).json()["data"]["id"]
    _vote(client, ctx["other_token"], "question", other_question_id, 1)
    resp = client.get(
        "/api/questions",
        params={"course_id": ctx["course_id"], "sort": "hot"},
        headers=_auth(ctx["other_token"]),
    )
    items = resp.json()["data"]["items"]
    assert [i["id"] for i in items] == [other_question_id, ctx["question_id"]]
    voted = next(i for i in items if i["id"] == other_question_id)
    assert voted["vote_score"] == 1 and voted["my_vote"] == 1
    not_voted = next(i for i in items if i["id"] == ctx["question_id"])
    assert not_voted["my_vote"] == 0


def test_answer_votes_sort_and_my_vote(client: TestClient, db_session: Session) -> None:
    """sort=votes 按投票分降序；回答列表回填 vote_score/my_vote。"""
    ctx = _setup(client, db_session, "S2")
    challenger_id = client.post(
        f"/api/questions/{ctx['question_id']}/answers",
        json={"body": "更优的解答。"},
        headers=_auth(ctx["asker_token"]),
    ).json()["data"]["id"]
    _vote(client, ctx["other_token"], "answer", challenger_id, 1)
    resp = client.get(
        f"/api/questions/{ctx['question_id']}/answers",
        params={"sort": "votes"},
        headers=_auth(ctx["other_token"]),
    )
    items = resp.json()["data"]["items"]
    assert items[0]["id"] == challenger_id
    assert items[0]["vote_score"] == 1 and items[0]["my_vote"] == 1


def test_question_detail_my_vote(client: TestClient, db_session: Session) -> None:
    """问题详情回填 vote_score/my_vote。"""
    ctx = _setup(client, db_session, "S3")
    _vote(client, ctx["other_token"], "question", ctx["question_id"], -1)
    resp = client.get(
        f"/api/questions/{ctx['question_id']}", headers=_auth(ctx["other_token"])
    )
    data = resp.json()["data"]
    assert data["vote_score"] == -1 and data["my_vote"] == -1
