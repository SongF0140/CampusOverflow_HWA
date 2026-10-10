# interaction 投票与声誉测试：E-04 toggle 状态机、积分流水、榜单、采纳 +15 与排序回填（T-08）
from datetime import datetime, timedelta

import pytest
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


@pytest.mark.parametrize("first_valid", [0, 3])
def test_rank_bounded_batches_fill_missing_users(db_session, monkeypatch, first_valid):
    from app.modules.identity import service as identity_service
    from app.modules.interaction import service

    valid_ids = list(range(1, first_valid + 1)) + list(range(101, 111))
    db_session.add_all([
        User(id=user_id, username=f"batch_{user_id}", email=f"b{user_id}@example.com",
             password_hash="unused", role="student")
        for user_id in valid_ids
    ])
    db_session.add_all([
        ReputationLog(user_id=user_id, delta=5, reason="accept", ref_type="answer",
                      ref_id=user_id, created_at=datetime.now())
        for user_id in range(1, 111)
    ])
    db_session.commit()
    batches = []
    original = identity_service.get_usernames_by_ids

    def names(db, ids):
        batches.append(ids)
        assert len(ids) <= 100
        return original(db, ids)

    monkeypatch.setattr(identity_service, "get_usernames_by_ids", names)
    result = service.rank(db_session, "week", None)
    assert [item.user_id for item in result.items] == valid_ids[:10]
    assert [len(ids) for ids in batches] == [100, 10]


@pytest.mark.parametrize("period,days", [("week", 7), ("month", 30)])
@pytest.mark.parametrize("course_id", [None, 7])
def test_rank_window_stays_fixed_across_batches(db_session, monkeypatch, period, days, course_id):
    from app.modules.identity import service as identity_service
    from app.modules.interaction import repository, service

    started_at = datetime(2026, 10, 3, 12)
    current_time = started_at

    class Clock(datetime):
        @classmethod
        def now(cls):
            return current_time

    valid_ids = [1] + list(range(101, 111))
    db_session.add_all([
        User(id=user_id, username=f"clock_{user_id}", email=f"c{user_id}@example.com",
             password_hash="unused", role="student")
        for user_id in valid_ids
    ])
    db_session.add_all([
        ReputationLog(user_id=user_id, delta=-5 if user_id == 1 else (
            0 if user_id <= 100 else -10
        ), reason="accept", ref_type="answer", ref_id=user_id,
            course_id=7, created_at=started_at)
        for user_id in range(1, 111)
    ] + [ReputationLog(
        user_id=1, delta=10, reason="answer_upvoted", ref_type="answer", ref_id=1,
        course_id=7, created_at=started_at - timedelta(days=days),
    )])
    db_session.commit()
    batches = []
    original = identity_service.get_usernames_by_ids

    def names(db, ids):
        nonlocal current_time
        batches.append(ids)
        current_time = started_at + timedelta(seconds=1)
        return original(db, ids)

    monkeypatch.setattr(repository, "datetime", Clock)
    monkeypatch.setattr(service, "datetime", Clock, raising=False)
    monkeypatch.setattr(identity_service, "get_usernames_by_ids", names)
    items = service.rank(db_session, period, course_id).items
    assert [(item.user_id, item.score) for item in items] == (
        [(1, 5)] + [(user_id, -10) for user_id in range(101, 110)]
    )
    assert batches == [list(range(1, 101)), list(range(101, 111))]
    later_items = service.rank(db_session, period, course_id).items
    assert [(item.user_id, item.score) for item in later_items] == (
        [(1, -5)] + [(user_id, -10) for user_id in range(101, 110)]
    )


def test_rank_candidate_keyset_ties_and_sql_limit(db_session):
    from sqlalchemy import event

    from app.modules.interaction import repository
    from app.modules.interaction.schemas import RankCandidateData

    db_session.add_all([
        ReputationLog(user_id=user_id, delta=0 if user_id <= 205 else -2,
                      reason="accept", ref_type="answer", ref_id=user_id,
                      created_at=datetime.now())
        for user_id in range(1, 211)
    ])
    db_session.commit()
    limits = []

    def capture(connection, cursor, statement, parameters, context, executemany):
        if "sum(" in statement.lower():
            assert "LIMIT" in statement
            limits.append(parameters[-2])

    event.listen(db_session.bind, "before_cursor_execute", capture)
    as_of = datetime.now()
    try:
        candidates = []
        score = user_id = None
        while True:
            batch = repository.list_rank_candidate_batch(
                db_session, "week", None, score, user_id, as_of, limit=1000
            )
            assert len(batch) <= 100
            assert all(isinstance(item, RankCandidateData) for item in batch)
            if not batch:
                break
            candidates.extend(batch)
            score, user_id = batch[-1].score, batch[-1].user_id
    finally:
        event.remove(db_session.bind, "before_cursor_execute", capture)
    assert [item.user_id for item in candidates] == list(range(1, 211))
    assert [item.score for item in candidates] == [0] * 205 + [-2] * 5
    assert limits == [100, 100, 100, 100]
    assert len(repository.list_rank_candidate_batch(
        db_session, "week", None, None, None, as_of, limit=-1
    )) == 1


def test_reputation_log_internal_contract_and_private_pagination(client, db_session):
    from pydantic import BaseModel

    from app.modules.interaction import repository

    owner = _create_user(db_session, "log_owner")
    other = _create_user(db_session, "log_other")
    now = datetime.now()
    db_session.add_all([
        ReputationLog(user_id=owner.id, delta=delta, reason="accept", ref_type="answer",
                      ref_id=delta, created_at=now)
        for delta in [1, 2, 3]
    ] + [ReputationLog(user_id=other.id, delta=99, reason="accept", ref_type="answer",
                       ref_id=99, created_at=now)])
    db_session.commit()
    logs, total = repository.list_reputation_logs(db_session, owner.id, 2, 1)
    assert total == 3 and len(logs) == 1
    assert isinstance(logs[0], BaseModel)
    assert not hasattr(logs[0], "_sa_instance_state")
    assert logs[0].delta == 2
    response = client.get(
        "/api/reputation/me", params={"page": 2, "page_size": 1, "user_id": other.id},
        headers=_auth(_login(client, owner.username)),
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert set(data) == {"score", "logs", "total", "page", "page_size"}
    assert (data["total"], data["page"], data["page_size"]) == (3, 2, 1)
    assert data["logs"][0]["delta"] == 2
    assert set(data["logs"][0]) == {"delta", "reason", "ref_type", "ref_id", "created_at"}
    empty = client.get(
        "/api/reputation/me", params={"page": 4, "page_size": 1},
        headers=_auth(_login(client, owner.username)),
    ).json()["data"]
    assert empty["logs"] == [] and empty["total"] == 3


@pytest.mark.parametrize("initial,value,fail_at", [(None, 1, 1), (1, 1, 1), (1, -1, 2)])
def test_vote_outer_log_failure_rolls_back(client, db_session, monkeypatch,
                                          initial, value, fail_at):
    from app.modules.interaction import repository, service
    from app.modules.qa.models import Answer

    ctx = _setup(client, db_session, "TXV")
    voter = db_session.query(User.id).filter(User.username == "a_TXV").scalar()
    author = db_session.query(User.id).filter(User.username == "u_TXV").scalar()
    if initial is not None:
        service.vote(db_session, voter, "answer", ctx["answer_id"], initial)
    original = repository.create_reputation_log
    calls = 0

    def fail_log(*args, **kwargs):
        nonlocal calls
        calls += 1
        original(*args, **kwargs)
        if calls == fail_at:
            raise RuntimeError("injected log failure")

    monkeypatch.setattr(repository, "create_reputation_log", fail_log)
    with pytest.raises(RuntimeError, match="injected log failure"):
        service.vote(db_session, voter, "answer", ctx["answer_id"], value)
    assert db_session.is_active
    assert repository.get_vote_value(db_session, "answer", ctx["answer_id"], voter) == initial
    assert db_session.query(Answer.vote_score).scalar() == (initial or 0)
    assert db_session.query(User.reputation_score).filter(User.id == author).scalar() == (
        10 if initial else 0
    )
    assert db_session.query(ReputationLog).count() == (1 if initial else 0)


@pytest.mark.parametrize("failure", ["runtime", "integrity"])
def test_accept_outer_log_failure_rolls_back(client, db_session, monkeypatch, failure):
    from sqlalchemy.exc import IntegrityError

    from app.modules.interaction import repository, service
    from app.modules.qa.models import Question

    ctx = _setup(client, db_session, "TXA")
    asker = db_session.query(User.id).filter(User.username == "a_TXA").scalar()
    original = repository.create_reputation_log
    error = (IntegrityError("injected", {}, RuntimeError("unknown constraint"))
             if failure == "integrity" else RuntimeError("injected log failure"))

    def fail_log(*args, **kwargs):
        original(*args, **kwargs)
        raise error

    monkeypatch.setattr(repository, "create_reputation_log", fail_log)
    with pytest.raises(type(error)) as caught:
        service.accept_answer(db_session, asker, ctx["answer_id"])
    assert caught.value is error
    assert db_session.is_active
    question = db_session.get(Question, ctx["question_id"])
    assert question.accepted_answer_id is None and question.status == "published"
    assert db_session.query(User.reputation_score).filter(User.username == "u_TXA").scalar() == 0
    assert db_session.query(ReputationLog).count() == 0


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/questions"),
    ("GET", "/api/questions/{question_id}"),
    ("GET", "/api/questions/{question_id}/answers"),
    ("POST", "/api/answers/{answer_id}/accept"),
])
def test_composition_route_owner_and_unique(method, path):
    from app.main import app

    mounted = [
        route for included in app.routes
        for route in getattr(getattr(included, "original_router", None), "routes", [included])
    ]
    routes = [r for r in mounted if getattr(r, "path", None) == path
              and method in getattr(r, "methods", set())]
    assert len(routes) == 1
    assert routes[0].endpoint.__module__ == "app.modules.interaction.router"


def test_composition_dependency_direction():
    import ast
    import tomllib
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    for path in (root / "app/modules/qa").glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith("app.modules.interaction")
            elif isinstance(node, ast.Import):
                assert all(not a.name.startswith("app.modules.interaction") for a in node.names)
    contracts = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))[
        "tool"]["importlinter"]["contracts"]
    assert any(c["type"] == "forbidden" and "app.modules.qa" in c["source_modules"]
               and "app.modules.interaction" in c["forbidden_modules"] for c in contracts)


def test_composition_qa_participants_flush_only(client, db_session, monkeypatch):
    import inspect

    from app.modules.qa import schemas, service
    from app.modules.qa.models import Question

    ctx = _setup(client, db_session, "CP1")
    assert hasattr(service, "prepare_answer_acceptance")
    assert hasattr(schemas, "AcceptedAnswerData")
    for name in ("list_questions", "get_question_detail", "list_answers"):
        assert "viewer_id" not in inspect.signature(getattr(service, name)).parameters

    def forbid_commit():
        pytest.fail("参与能力不得提交事务")

    monkeypatch.setattr(db_session, "commit", forbid_commit)
    items, total = service.list_questions(db_session, 1, 20, None, "latest", False, None)
    assert total == 1 and items[0].my_vote == 0
    answers, total = service.list_answers(db_session, ctx["question_id"], "latest", 1, 20)
    assert total == 1 and answers[0].my_vote == 0
    detail = service.get_question_detail(db_session, ctx["question_id"])
    assert detail.my_vote == 0 and detail.view_count == 1
    asker_id = db_session.query(User.id).filter(User.username == "a_CP1").scalar()
    result = service.prepare_answer_acceptance(db_session, asker_id, ctx["answer_id"])
    assert isinstance(result, schemas.AcceptedAnswerData)
    assert result.model_dump() == {
        "question_id": ctx["question_id"],
        "answer_id": ctx["answer_id"],
        "author_id": db_session.query(User.id).filter(User.username == "u_CP1").scalar(),
        "course_id": ctx["course_id"],
    }
    assert db_session.query(ReputationLog).count() == 0
    db_session.rollback()
    question = db_session.get(Question, ctx["question_id"])
    assert question.view_count == 0 and question.accepted_answer_id is None
    assert question.status == "published"


def test_composition_queries_batch_votes_and_detail_once(client, db_session, monkeypatch):
    from app.modules.interaction import service
    from app.modules.qa.models import Question

    ctx = _setup(client, db_session, "CP2")
    _vote(client, ctx["other_token"], "question", ctx["question_id"], -1)
    _vote(client, ctx["other_token"], "answer", ctx["answer_id"], 1)
    calls = []
    original = service.get_my_vote_map

    def get_votes(db, user_id, target_type, ids):
        calls.append((db, target_type, ids))
        return original(db, user_id, target_type, ids)

    monkeypatch.setattr(service, "get_my_vote_map", get_votes)
    viewer = db_session.query(User.id).filter(User.username == "u_CP2").scalar()
    assert hasattr(service, "list_questions")
    questions, total = service.list_questions(
        db_session, 1, 20, None, "latest", False, None, viewer
    )
    assert total == 1 and questions[0].my_vote == -1
    answers, total = service.list_answers(db_session, ctx["question_id"], "latest", 1, 20, viewer)
    assert total == 1 and answers[0].my_vote == 1
    detail = service.get_question_detail(db_session, ctx["question_id"], viewer)
    assert detail.my_vote == -1 and detail.view_count == 1
    assert db_session.query(Question.view_count).scalar() == 1
    assert calls == [(db_session, "question", [ctx["question_id"]]),
                     (db_session, "answer", [ctx["answer_id"]]),
                     (db_session, "question", [ctx["question_id"]])]
    response = client.get(f"/api/questions/{ctx['question_id']}/answers",
                          headers=_auth(ctx["other_token"]))
    assert set(response.json()["data"]) == {"items", "total", "page"}


def test_composition_accept_session_commit_and_error_order(client, db_session, monkeypatch):
    from app.modules.interaction import service
    from app.modules.qa import domain
    from app.modules.qa import service as qa_service
    from app.modules.qa.models import Answer, Question

    ctx = _setup(client, db_session, "CP3")
    assert hasattr(service, "accept_answer")
    original_prepare = qa_service.prepare_answer_acceptance
    original_grant = service.grant_reputation
    original_commit = db_session.commit
    calls = []

    def prepare(db, user_id, answer_id):
        calls.append(("prepare", db))
        return original_prepare(db, user_id, answer_id)

    def grant(db, **kwargs):
        calls.append(("grant", db))
        return original_grant(db, **kwargs)

    def commit():
        calls.append(("commit", db_session))
        original_commit()

    monkeypatch.setattr(qa_service, "prepare_answer_acceptance", prepare)
    monkeypatch.setattr(service, "grant_reputation", grant)
    monkeypatch.setattr(db_session, "commit", commit)
    asker = db_session.query(User.id).filter(User.username == "a_CP3").scalar()
    other = db_session.query(User.id).filter(User.username == "u_CP3").scalar()
    assert service.accept_answer(db_session, asker, ctx["answer_id"]) == {
        "accepted": True, "question_status": "resolved",
    }
    assert calls == [("prepare", db_session), ("grant", db_session), ("commit", db_session)]
    assert db_session.query(User.reputation_score).filter(User.id == other).scalar() == 15
    log = db_session.query(ReputationLog).one()
    assert (log.delta, log.reason, log.ref_type, log.ref_id, log.course_id) == (
        15, "accept", "answer", ctx["answer_id"], ctx["course_id"]
    )
    with pytest.raises(domain.AcceptDeniedError):
        service.accept_answer(db_session, other, ctx["answer_id"])
    with pytest.raises(domain.AlreadyAcceptedError):
        service.accept_answer(db_session, asker, ctx["answer_id"])
    question = db_session.get(Question, ctx["question_id"])
    question.deleted_at = datetime.now()
    db_session.flush()
    with pytest.raises(domain.QuestionNotFoundError):
        service.accept_answer(db_session, other, ctx["answer_id"])
    db_session.get(Answer, ctx["answer_id"]).deleted_at = datetime.now()
    db_session.flush()
    with pytest.raises(domain.AnswerNotFoundError):
        service.accept_answer(db_session, other, ctx["answer_id"])
    db_session.rollback()
    assert db_session.query(ReputationLog).count() == 1


@pytest.mark.parametrize("method,path", [
    ("get", "/api/questions"),
    ("get", "/api/questions/1"),
    ("get", "/api/questions/1/answers"),
    ("post", "/api/answers/1/accept"),
])
def test_composition_authentication_unchanged(client, db_session, method, path):
    assert getattr(client, method)(path).status_code == 401
    user = _create_user(db_session, "composition_banned")
    token = _login(client, user.username)
    user.status = "banned"
    db_session.commit()
    assert getattr(client, method)(path, headers=_auth(token)).status_code == 403


@pytest.mark.parametrize("target_type", ["question", "answer"])
def test_qa_vote_target_contract_without_side_effects(
    client: TestClient, db_session: Session, monkeypatch, target_type: str
) -> None:
    from app.modules.qa import service
    from app.modules.qa.models import Question

    ctx = _setup(client, db_session, "QC1")
    target_id = ctx[f"{target_type}_id"]
    view_count = db_session.query(Question.view_count).scalar()

    def forbid_commit():
        pytest.fail("内部 QA 能力不得提交事务")

    monkeypatch.setattr(db_session, "commit", forbid_commit)
    target = service.get_vote_target(db_session, target_type, target_id)
    from app.modules.qa.schemas import VoteTargetData

    assert isinstance(target, VoteTargetData)
    assert target.id == target_id
    assert target.course_id == ctx["course_id"]
    assert target.deleted_at is None
    username = "a_QC1" if target_type == "question" else "u_QC1"
    assert target.author_id == db_session.query(User.id).filter(User.username == username).scalar()
    assert db_session.query(Question.view_count).scalar() == view_count
    assert service.get_vote_target(db_session, target_type, 99999) is None
    assert service.get_vote_score(db_session, target_type, 99999) == 0


@pytest.mark.parametrize("target_type", ["question", "answer"])
def test_qa_vote_score_increment_can_rollback(
    client: TestClient, db_session: Session, monkeypatch, target_type: str
) -> None:
    from app.modules.qa import service

    ctx = _setup(client, db_session, "QC2")
    target_id = ctx[f"{target_type}_id"]

    def forbid_commit():
        pytest.fail("内部 QA 能力不得提交事务")

    monkeypatch.setattr(db_session, "commit", forbid_commit)
    service.adjust_vote_score(db_session, target_type, target_id, 2)
    service.adjust_vote_score(db_session, target_type, target_id, -1)
    assert service.get_vote_score(db_session, target_type, target_id) == 1
    db_session.rollback()
    assert service.get_vote_score(db_session, target_type, target_id) == 0


def test_qa_deleted_target_and_answer_parent_policy(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    from app.modules.qa import service
    from app.modules.qa.models import Answer, Question

    ctx = _setup(client, db_session, "QC3")
    question = db_session.get(Question, ctx["question_id"])
    answer = db_session.get(Answer, ctx["answer_id"])
    asker_id, answerer_id = question.author_id, answer.author_id
    question.deleted_at = datetime.now()
    db_session.commit()

    def forbid_commit():
        pytest.fail("内部 QA 读取不得提交事务")

    with monkeypatch.context() as patch:
        patch.setattr(db_session, "commit", forbid_commit)
        target = service.get_vote_target(db_session, "question", question.id)
        assert target.deleted_at is not None
        target = service.get_vote_target(db_session, "answer", answer.id)
        assert target.deleted_at is None and target.course_id == ctx["course_id"]
        from app.modules.qa.schemas import PublicContentCounts

        counts = service.get_public_content_counts(db_session, answerer_id)
        assert isinstance(counts, PublicContentCounts)
        assert counts.question_count == 0 and counts.answer_count == 1
        assert service.get_public_content_counts(db_session, asker_id).question_count == 0
        assert service.get_public_content_counts(db_session, 99999).model_dump() == {
            "question_count": 0, "answer_count": 0,
        }
    resp = _vote(client, ctx["asker_token"], "answer", answer.id, 1)
    assert resp.status_code == 200
    assert db_session.query(ReputationLog).one().course_id == ctx["course_id"]
    answer.deleted_at = datetime.now()
    db_session.commit()
    assert service.get_vote_target(db_session, "answer", answer.id).deleted_at is not None
    assert service.get_public_content_counts(db_session, answerer_id).answer_count == 0
    assert _vote(client, ctx["asker_token"], "answer", answer.id, 1).status_code == 404


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


@pytest.mark.parametrize("target_type", ["question", "answer"])
def test_locked_target_refreshes_identity_map(client, db_session, target_type):
    from sqlalchemy import update

    from app.modules.qa import repository
    from app.modules.qa.models import Answer, Question

    ctx = _setup(client, db_session, "TXR")
    model = Question if target_type == "question" else Answer
    target_id = ctx[f"{target_type}_id"]
    stale = db_session.get(model, target_id)
    db_session.execute(update(model).where(model.id == target_id).values(
        deleted_at=datetime.now()
    ).execution_options(synchronize_session=False))
    assert stale.deleted_at is None
    locked = repository.lock_vote_target(db_session, target_type, target_id)
    assert locked.deleted_at is not None
    assert stale.deleted_at is not None


@pytest.mark.parametrize("target_type", ["question", "answer"])
def test_delete_commit_failure_rolls_back(client, db_session, monkeypatch, target_type):
    from app.modules.interaction import service
    from app.modules.qa import service as qa_service
    from app.modules.qa.models import Answer, Question

    ctx = _setup(client, db_session, "TXD")
    asker = db_session.query(User.id).filter(User.username == "a_TXD").scalar()
    author = db_session.query(User.id).filter(User.username == "u_TXD").scalar()
    service.accept_answer(db_session, asker, ctx["answer_id"])

    def fail_commit():
        raise RuntimeError("injected commit failure")

    with monkeypatch.context() as patch:
        patch.setattr(db_session, "commit", fail_commit)
        with pytest.raises(RuntimeError, match="injected commit failure"):
            if target_type == "question":
                qa_service.delete_question(db_session, "student", asker, ctx["question_id"])
            else:
                qa_service.delete_answer(db_session, "student", author, ctx["answer_id"])
    assert db_session.is_active
    question = db_session.get(Question, ctx["question_id"])
    assert question.deleted_at is None and question.status == "resolved"
    assert question.accepted_answer_id == ctx["answer_id"]
    assert db_session.get(Answer, ctx["answer_id"]).deleted_at is None
    qa_service.delete_answer(db_session, "student", author, ctx["answer_id"])
    assert db_session.query(User.reputation_score).filter(User.id == author).scalar() == 15
    assert db_session.query(ReputationLog).one().delta == 15
    assert db_session.get(Question, ctx["question_id"]).accepted_answer_id is None


# ---------- 模块边界与事务回归 ----------


def test_identity_reputation_increment_can_rollback(db_session: Session) -> None:
    from app.modules.identity import service as identity_service

    user_id = _create_user(db_session, "identity_rollback").id
    identity_service.adjust_user_reputation(db_session, user_id, 10)
    assert db_session.query(User.reputation_score).filter(User.id == user_id).scalar() == 10
    db_session.rollback()
    assert db_session.query(User.reputation_score).filter(User.id == user_id).scalar() == 0


def test_grant_reputation_score_and_log_rollback(db_session: Session) -> None:
    from app.modules.interaction import service

    user_id = _create_user(db_session, "grant_rollback").id
    service.grant_reputation(db_session, user_id, 10, "answer_upvoted", "answer", 1)
    assert db_session.query(User.reputation_score).filter(User.id == user_id).scalar() == 10
    assert db_session.query(ReputationLog).count() == 1
    db_session.rollback()
    assert db_session.query(User.reputation_score).filter(User.id == user_id).scalar() == 0
    assert db_session.query(ReputationLog).count() == 0


def test_log_failure_does_not_commit_score(db_session: Session, monkeypatch) -> None:
    from app.modules.interaction import repository, service

    user_id = _create_user(db_session, "log_failure").id

    def fail_log(*args, **kwargs):
        raise RuntimeError("log failure")

    monkeypatch.setattr(repository, "create_reputation_log", fail_log)
    with pytest.raises(RuntimeError, match="log failure"):
        service.grant_reputation(db_session, user_id, 10, "answer_upvoted", "answer", 1)
    assert db_session.query(User.reputation_score).filter(User.id == user_id).scalar() == 10
    db_session.rollback()
    assert db_session.query(User.reputation_score).filter(User.id == user_id).scalar() == 0
    assert db_session.query(ReputationLog).count() == 0


def test_total_rank_zero_ties_and_limit(db_session: Session) -> None:
    from app.modules.identity import service as identity_service
    from app.modules.interaction import service

    users = [
        _create_user(db_session, f"total_{i}", reputation_score=10 if i < 2 else 0)
        for i in range(12)
    ]
    expected_ids = [user.id for user in users[:10]]
    items = service.rank(db_session, "all", None).items
    assert [item.user_id for item in items] == expected_ids
    assert [item.score for item in items] == [10, 10] + [0] * 8
    internal = identity_service.list_reputation_rank(db_session, 10)
    assert [item.user_id for item in internal] == expected_ids


@pytest.mark.parametrize("period,course_id", [("week", None), ("month", None), ("all", 7)])
def test_window_rank_batch_names_order_and_missing_users(
    db_session: Session, monkeypatch, period: str, course_id: int | None
) -> None:
    from app.modules.identity import service as identity_service
    from app.modules.interaction import service

    users = [_create_user(db_session, f"window_{i}") for i in range(12)]
    user_ids = [user.id for user in users]
    now = datetime.now()
    for user_id in user_ids:
        db_session.add(ReputationLog(
            user_id=user_id, delta=5, reason="accept", ref_type="answer", ref_id=1,
            course_id=7, created_at=now,
        ))
    db_session.add_all([
        ReputationLog(user_id=99999, delta=100, reason="accept", ref_type="answer",
                      ref_id=1, course_id=7, created_at=now),
        ReputationLog(user_id=user_ids[-1], delta=100, reason="accept", ref_type="answer",
                      ref_id=1, course_id=8, created_at=now - timedelta(days=31)),
        ReputationLog(user_id=user_ids[0], delta=-5, reason="upvote_cancelled",
                      ref_type="answer", ref_id=1, course_id=7, created_at=now),
    ])
    db_session.commit()
    original = identity_service.get_usernames_by_ids
    calls = []

    def get_names(db, ids):
        calls.append(ids)
        return original(db, ids)

    monkeypatch.setattr(identity_service, "get_usernames_by_ids", get_names)
    items = service.rank(db_session, period, course_id).items
    assert [item.user_id for item in items] == user_ids[1:11]
    assert [item.username for item in items] == [f"window_{i}" for i in range(1, 11)]
    assert [item.score for item in items] == [5] * 10
    assert len(calls) == 1
    assert 99999 in calls[0]
    db_session.query(ReputationLog).filter(ReputationLog.user_id.in_(user_ids[1:])).delete()
    db_session.commit()
    remaining = service.rank(db_session, period, course_id).items
    assert [(item.user_id, item.score) for item in remaining] == [(user_ids[0], 0)]


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
