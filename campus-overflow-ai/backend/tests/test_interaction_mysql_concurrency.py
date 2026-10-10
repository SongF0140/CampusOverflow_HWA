"""仅在显式配置的、已迁移的 MySQL 专用测试库执行；不建表、不清空库。"""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.modules.courses.models import Course
from app.modules.identity.models import User
from app.modules.interaction import domain, service
from app.modules.interaction.models import (
    AnswerVote,
    Notification,
    QuestionVote,
    ReputationLog,
)
from app.modules.qa import domain as qa_domain
from app.modules.qa import service as qa_service
from app.modules.qa.models import Answer, Question


@pytest.fixture
def mysql_case():
    raw_url = os.environ.get("TEST_MYSQL_DATABASE_URL")
    if not raw_url:
        pytest.skip("未配置 TEST_MYSQL_DATABASE_URL；SQLite 不提供 MySQL 并发证据")
    url = make_url(raw_url)
    if url.get_backend_name() != "mysql" or "test" not in (url.database or "").lower():
        pytest.fail("专用测试 URL 必须指向库名含 test 的 MySQL 数据库", pytrace=False)
    engine = create_engine(url, pool_size=4, max_overflow=0)
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    token = "tx_" + uuid4().hex
    users = []
    course_id = question_id = None
    answer_ids = []
    try:
        with sessions() as db:
            users = [User(username=f"{token}_{i}", email=f"{token}_{i}@example.com",
                          password_hash="unused", role="student") for i in range(3)]
            db.add_all(users)
            db.flush()
            user_ids = [user.id for user in users]
            course = Course(name="并发测试", code=token, teacher_id=user_ids[0])
            db.add(course)
            db.flush()
            course_id = course.id
            question = Question(title="并发测试", body="测试", course_id=course_id,
                                author_id=user_ids[0])
            db.add(question)
            db.flush()
            question_id = question.id
            answers = [Answer(body="测试", question_id=question_id, author_id=user_ids[i])
                       for i in (1, 2)]
            db.add_all(answers)
            db.flush()
            answer_ids = [answer.id for answer in answers]
            db.commit()
        yield sessions, user_ids, question_id, answer_ids
    finally:
        # 只删除本次 UUID 创建的数据；不 drop/truncate，不操作其他测试或业务行。
        if question_id is not None:
            with sessions() as db:
                db.query(Question).filter(Question.id == question_id).update(
                    {Question.accepted_answer_id: None}, synchronize_session=False
                )
                db.query(AnswerVote).filter(AnswerVote.answer_id.in_(answer_ids)).delete(
                    synchronize_session=False
                )
                db.query(QuestionVote).filter(QuestionVote.question_id == question_id).delete(
                    synchronize_session=False
                )
                db.query(ReputationLog).filter(ReputationLog.user_id.in_(user_ids)).delete(
                    synchronize_session=False
                )
                # 本用例收件人均在 user_ids 内；先清通知再删用户（notifications 外键引用 users）
                db.query(Notification).filter(Notification.recipient_id.in_(user_ids)).delete(
                    synchronize_session=False
                )
                db.query(Answer).filter(Answer.id.in_(answer_ids)).delete(synchronize_session=False)
                db.query(Question).filter(Question.id == question_id).delete(
                    synchronize_session=False
                )
                db.query(Course).filter(Course.id == course_id).delete(synchronize_session=False)
                db.query(User).filter(User.id.in_(user_ids)).delete(synchronize_session=False)
                db.commit()
        engine.dispose()


def _race(sessions, question_id, answer_ids, operations):
    barrier = Barrier(2, timeout=10)

    def run(operation):
        with sessions() as db:
            # 提前装载旧状态与建立快照，验证锁后刷新和 MySQL 当前读。
            question = db.get(Question, question_id)
            answers = [db.get(Answer, answer_id) for answer_id in answer_ids]
            barrier.wait()
            try:
                result = operation(db)
                assert question is not None and all(answers)
                return result
            except (qa_domain.AlreadyAcceptedError, qa_domain.AnswerNotFoundError,
                    domain.VoteTargetNotFoundError) as error:
                return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run, operation) for operation in operations]
        return [future.result(timeout=30) for future in futures]


@pytest.mark.parametrize("target_type", ["question", "answer"])
@pytest.mark.parametrize("initial,value,expected", [(None, 1, None), (1, 1, 1), (1, -1, None)])
def test_mysql_toggle(mysql_case, target_type, initial, value, expected):
    sessions, users, question_id, answer_ids = mysql_case
    target_id = question_id if target_type == "question" else answer_ids[0]
    if initial is not None:
        with sessions() as db:
            service.vote(db, users[0], target_type, target_id, initial)
    results = _race(sessions, question_id, answer_ids, [
        lambda db: service.vote(db, users[0], target_type, target_id, value),
        lambda db: service.vote(db, users[0], target_type, target_id, value),
    ])
    assert all(not isinstance(result, Exception) for result in results)
    with sessions() as db:
        model = QuestionVote if target_type == "question" else AnswerVote
        column = model.question_id if target_type == "question" else model.answer_id
        votes = db.query(model.value).filter(column == target_id).all()
        assert votes == ([] if expected is None else [(expected,)])
        target = db.get(Question if target_type == "question" else Answer, target_id)
        assert target.vote_score == (expected or 0)
        author_id = users[0] if target_type == "question" else users[1]
        score = db.get(User, author_id).reputation_score
        assert score == (10 if target_type == "answer" and expected else 0)
        assert score == (db.query(func.sum(ReputationLog.delta)).filter(
            ReputationLog.user_id == author_id
        ).scalar() or 0)


def test_mysql_same_question_accept(mysql_case):
    sessions, users, question_id, answer_ids = mysql_case
    results = _race(sessions, question_id, answer_ids, [
        lambda db: service.accept_answer(db, users[0], answer_ids[0]),
        lambda db: service.accept_answer(db, users[0], answer_ids[1]),
    ])
    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(isinstance(result, qa_domain.AlreadyAcceptedError) for result in results) == 1
    with sessions() as db:
        question = db.get(Question, question_id)
        assert question.status == "resolved" and question.accepted_answer_id in answer_ids
        log = db.query(ReputationLog).filter(ReputationLog.user_id.in_(users)).one()
        assert log.delta == 15 and log.reason == "accept"
        assert log.ref_id == question.accepted_answer_id
        assert sum(db.get(User, user_id).reputation_score for user_id in users) == 15


@pytest.mark.parametrize("action", ["vote", "accept"])
def test_mysql_answer_delete_race(mysql_case, action):
    sessions, users, question_id, answer_ids = mysql_case
    answer_id = answer_ids[0]
    operation = (lambda db: service.vote(db, users[0], "answer", answer_id, 1)) if (
        action == "vote"
    ) else (lambda db: service.accept_answer(db, users[0], answer_id))
    results = _race(sessions, question_id, answer_ids, [
        operation, lambda db: qa_service.delete_answer(db, "student", users[1], answer_id),
    ])
    assert results[1] is None
    with sessions() as db:
        assert db.get(Answer, answer_id).deleted_at is not None
        question = db.get(Question, question_id)
        assert question.accepted_answer_id is None and question.status == "published"
        succeeded = not isinstance(results[0], Exception)
        expected = (10 if action == "vote" else 15) if succeeded else 0
        assert db.get(User, users[1]).reputation_score == expected
        logs = db.query(ReputationLog).filter(ReputationLog.user_id.in_(users)).all()
        assert sum(log.delta for log in logs) == expected
        assert len(logs) == int(succeeded)
        assert db.get(Answer, answer_id).vote_score == int(succeeded and action == "vote")
