# 通知模块测试（T-10，US-15/E-11）：回答/评论/采纳触发、仅本人可见、未读计数、幂等已读
# 覆盖接口文档 §8 契约与"内容+通知同事务"的回滚语义；主链路验收测试置本文件末尾。
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.modules.identity.models import User
from app.modules.interaction.models import Notification


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
    """测试辅助：教师建课 + a 提问 + u 回答，返回各 token 与 id。"""
    _create_user(db, f"t_{code}", role="teacher")
    teacher_token = _login(client, f"t_{code}")
    course_id = client.post(
        "/api/courses", json={"name": f"课程{code}", "code": code},
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
        json={"body": "我的解答。"}, headers=_auth(other_token),
    ).json()["data"]["id"]
    return {
        "teacher_token": teacher_token,
        "asker_token": asker_token,
        "other_token": other_token,
        "course_id": course_id,
        "question_id": question_id,
        "answer_id": answer_id,
    }


def _list_notifications(client: TestClient, token: str, **params) -> dict:
    return client.get("/api/notifications", headers=_auth(token), params=params).json()["data"]


# ---------- 触发规则（接口文档 §8.4：收件人、去重、剔除操作者） ----------


def test_answer_notifies_asker_only(client: TestClient, db_session: Session) -> None:
    """被回答通知提问者：type/title/link 固定文案与锚点；回答者本人无通知。"""
    ctx = _setup(client, db_session, "N1")
    data = _list_notifications(client, ctx["asker_token"])
    assert data["total"] == 1 and data["unread_count"] == 1
    item = data["items"][0]
    assert item["type"] == "answered"
    assert item["title"] == "你的问题收到新回答"
    assert item["link"] == f"/questions/{ctx['question_id']}#answer-{ctx['answer_id']}"
    assert item["is_read"] is False
    assert _list_notifications(client, ctx["other_token"])["total"] == 0


def test_comment_notifies_target_and_reply_dedup(client: TestClient, db_session: Session) -> None:
    """评论通知目标作者；二级回复合并目标作者+父评论作者并剔除操作者；自评不发。"""
    ctx = _setup(client, db_session, "N2")
    comment_id = client.post(
        f"/api/questions/{ctx['question_id']}/comments",
        json={"body": "同问。"}, headers=_auth(ctx["other_token"]),
    ).json()["data"]["id"]
    # a（提问者兼目标作者）回复 u 的评论：收件人={a 目标作者, u 父作者}-{a}=u
    client.post(
        f"/api/questions/{ctx['question_id']}/comments",
        json={"body": "补充说明。", "parent_id": comment_id},
        headers=_auth(ctx["asker_token"]),
    )
    # a 再自评自己问题：目标作者=操作者 → 不发
    client.post(
        f"/api/questions/{ctx['question_id']}/comments",
        json={"body": "自己补充。"}, headers=_auth(ctx["asker_token"]),
    )
    asker_data = _list_notifications(client, ctx["asker_token"])
    other_data = _list_notifications(client, ctx["other_token"])
    # a 的通知：setup 回答 1 条 + u 首次评论 1 条；a 的自评与回复不产生
    commented = [i for i in asker_data["items"] if i["type"] == "commented"]
    assert asker_data["total"] == 2 and len(commented) == 1
    assert commented[0]["title"] == "你的内容收到新评论"
    assert other_data["total"] == 1  # 仅 a 的回复这条（无去重重复）


def test_accept_notifies_answerer_self_accept_silent(
    client: TestClient, db_session: Session
) -> None:
    """被采纳通知回答者；自采纳仍 +15 但不发自通知。"""
    ctx = _setup(client, db_session, "N3")
    client.post(f"/api/answers/{ctx['answer_id']}/accept", headers=_auth(ctx["asker_token"]))
    data = _list_notifications(client, ctx["other_token"])
    assert data["total"] == 1
    assert data["items"][0]["type"] == "accepted"
    assert data["items"][0]["title"] == "你的回答已被采纳"
    # 自采纳：u 加入课程后自问自答并采纳 → +15 无通知
    client.post(f"/api/courses/{ctx['course_id']}/join", headers=_auth(ctx["other_token"]))
    question_id = client.post(
        "/api/questions",
        json={"title": "自答问题", "body": "自问自答。", "course_id": ctx["course_id"]},
        headers=_auth(ctx["other_token"]),
    ).json()["data"]["id"]
    answer_id = client.post(
        f"/api/questions/{question_id}/answers", json={"body": "自答。"},
        headers=_auth(ctx["other_token"]),
    ).json()["data"]["id"]
    client.post(f"/api/answers/{answer_id}/accept", headers=_auth(ctx["other_token"]))
    me = client.get("/api/reputation/me", headers=_auth(ctx["other_token"])).json()["data"]
    assert me["score"] == 30  # 15（被采纳）+15（自采纳）
    assert _list_notifications(client, ctx["other_token"])["total"] == 1  # 仍只有被采纳一条


def test_comment_failure_rolls_back_notification(client: TestClient, db_session: Session) -> None:
    """内容与通知同事务：空评论 400 后不留任何通知残留。"""
    ctx = _setup(client, db_session, "N4")
    resp = client.post(
        f"/api/questions/{ctx['question_id']}/comments",
        json={"body": "   "}, headers=_auth(ctx["other_token"]),
    )
    assert resp.status_code == 400
    assert db_session.query(Notification).filter(Notification.type == "commented").count() == 0


# ---------- 可见性与已读（US-15/E-11，接口文档 §8.3/§8.5） ----------


def test_list_visibility_pagination_and_unread_count(
    client: TestClient, db_session: Session
) -> None:
    """仅本人可见；unread_only 筛选；unread_count 恒为本人全部未读数（与分页/筛选无关）。"""
    ctx = _setup(client, db_session, "N5")
    asker_id = db_session.query(User.id).filter(User.username == "a_N5").scalar()
    for i in range(3):
        db_session.add(Notification(
            recipient_id=asker_id, type="commented", title="你的内容收到新评论",
            link=f"/questions/{ctx['question_id']}#comment-{i}",
        ))
    db_session.add(Notification(
        recipient_id=asker_id, type="commented", title="已读种子",
        link="/questions/1", is_read=True,
    ))
    db_session.commit()
    # 未登录 401
    assert client.get("/api/notifications").status_code == 401
    data = _list_notifications(client, ctx["asker_token"], page_size=2)
    # setup 回答通知 1 条未读 + 种子 3 未读 1 已读 = total 5 / unread 4
    assert data["total"] == 5 and data["unread_count"] == 4  # 全部未读数不受 page_size 影响
    assert len(data["items"]) == 2
    unread = _list_notifications(client, ctx["asker_token"], unread_only=True, page_size=2)
    assert unread["total"] == 4 and unread["unread_count"] == 4
    # 他人不可见
    assert _list_notifications(client, ctx["other_token"])["total"] == 0


def test_read_single_idempotent_and_404(client: TestClient, db_session: Session) -> None:
    """单条已读幂等；不存在/非本人 404 不泄露归属；未登录 401。"""
    ctx = _setup(client, db_session, "N6")
    notification_id = _list_notifications(client, ctx["asker_token"])["items"][0]["id"]
    read_url = f"/api/notifications/{notification_id}/read"
    first = client.post(read_url, headers=_auth(ctx["asker_token"]))
    assert first.status_code == 200 and first.json()["data"]["unread_count"] == 0
    again = client.post(read_url, headers=_auth(ctx["asker_token"]))
    assert again.status_code == 200 and again.json()["data"]["unread_count"] == 0
    assert client.post(read_url, headers=_auth(ctx["other_token"])).status_code == 404
    missing = client.post("/api/notifications/99999/read", headers=_auth(ctx["asker_token"]))
    assert missing.status_code == 404
    assert client.post(read_url).status_code == 401


def test_read_all_idempotent(client: TestClient, db_session: Session) -> None:
    """全部已读幂等；之后新增的通知不受影响。"""
    ctx = _setup(client, db_session, "N7")
    for _ in range(2):
        resp = client.post("/api/notifications/read-all", headers=_auth(ctx["asker_token"]))
        assert resp.status_code == 200
        assert resp.json()["data"]["unread_count"] == 0
    client.post(
        f"/api/questions/{ctx['question_id']}/comments", json={"body": "新评论。"},
        headers=_auth(ctx["other_token"]),
    )
    assert _list_notifications(client, ctx["asker_token"])["unread_count"] == 1


# ---------- 主链路验收（加入课程→提问→回答→投票→采纳→积分→通知） ----------


def test_main_chain_acceptance(client: TestClient, db_session: Session) -> None:
    """一期主链路端到端：全链 200，声誉 10+15=25，流水与通知齐备。"""
    ctx = _setup(client, db_session, "W1")
    # 提问者给回答点赞 → 回答者 +10
    assert client.post(
        "/api/votes",
        json={"target_type": "answer", "target_id": ctx["answer_id"], "value": 1},
        headers=_auth(ctx["asker_token"]),
    ).status_code == 200
    # 采纳 → 回答者 +15、问题已解决
    assert client.post(
        f"/api/answers/{ctx['answer_id']}/accept", headers=_auth(ctx["asker_token"])
    ).status_code == 200
    me = client.get("/api/reputation/me", headers=_auth(ctx["other_token"])).json()["data"]
    assert me["score"] == 25
    assert {log["reason"] for log in me["logs"]} == {"answer_upvoted", "accept"}
    # 通知：提问者收到 answered；回答者收到 accepted
    asker_types = {i["type"] for i in _list_notifications(client, ctx["asker_token"])["items"]}
    other_types = {i["type"] for i in _list_notifications(client, ctx["other_token"])["items"]}
    assert asker_types == {"answered"}
    assert other_types == {"accepted"}
