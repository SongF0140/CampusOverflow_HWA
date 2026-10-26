# T-15-B 静默巡检测试（US-13）：全站巡检清单接口（三类内容/可见性过滤/判重）
# 与 Agent 建单接口（幂等 repeat、pending 工单只建单不处置 C-06）。
from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.courses.models import Course
from app.modules.governance.models import ModerationCase
from app.modules.identity.models import User
from app.modules.qa.models import Answer, Comment, Question

SERVICE_AUTH = {"X-Service-Token": settings.agent_service_token}


def _create_user(db: Session, username: str, role: str = "student") -> User:
    user = User(
        username=username, email=f"{username}@example.com",
        password_hash="unused", role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_patrol_contents_lists_all_types_and_filters(
    client: TestClient, db_session: Session
) -> None:
    """清单覆盖问题/回答/评论三类；软删/隐藏排除；未带服务 token 401。"""
    student = _create_user(db_session, "patrol_stu", "student")
    teacher = _create_user(db_session, "patrol_tea", "teacher")
    course = Course(name="巡检课程", code="CS-PATROL", teacher_id=teacher.id)
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    visible_q = Question(
        title="正常问题", body="正常问题正文", course_id=course.id, author_id=student.id,
    )
    hidden_q = Question(
        title="隐藏问题", body="隐藏正文", course_id=course.id, author_id=student.id,
        is_hidden=True,
    )
    deleted_q = Question(
        title="已删问题", body="已删正文", course_id=course.id, author_id=student.id,
        deleted_at=datetime(2026, 10, 24),
    )
    db_session.add_all([visible_q, hidden_q, deleted_q])
    db_session.commit()
    db_session.refresh(visible_q)

    answer = Answer(
        body="回答正文", question_id=visible_q.id, author_id=student.id,
    )
    hidden_answer = Answer(
        body="隐藏回答", question_id=visible_q.id, author_id=student.id, is_hidden=True,
    )
    comment = Comment(body="评论正文", question_id=visible_q.id, author_id=student.id)
    answer_comment = Answer(
        body="父回答正文", question_id=visible_q.id, author_id=teacher.id,
    )
    db_session.add_all([answer, hidden_answer, comment, answer_comment])
    db_session.commit()
    db_session.refresh(answer)
    db_session.refresh(answer_comment)
    reply = Comment(body="回复正文", answer_id=answer.id, author_id=student.id)
    comment_on_answer = Comment(
        body="评论回答正文", answer_id=answer_comment.id, author_id=student.id,
    )
    db_session.add_all([reply, comment_on_answer])
    db_session.commit()

    assert client.get("/internal/agent/patrol/contents").status_code == 401
    resp = client.get("/internal/agent/patrol/contents?hours=24", headers=SERVICE_AUTH)
    assert resp.status_code == 200
    items = resp.json()["data"]["items"]
    by_key = {(item["target_type"], item["target_id"]): item for item in items}

    # 三类可见内容在列，隐藏/软删排除
    assert ("question", visible_q.id) in by_key
    assert ("answer", answer.id) in by_key
    assert ("comment", comment.id) in by_key
    assert ("comment", reply.id) in by_key
    assert ("comment", comment_on_answer.id) in by_key
    assert all(("question", hidden_q.id) != key for key in by_key)
    assert all(("question", deleted_q.id) != key for key in by_key)
    assert all(("answer", hidden_answer.id) != key for key in by_key)

    # 课程归属：回答与"评论回答"都经父问题推导出 course_id
    assert by_key[("answer", answer.id)]["course_id"] == course.id
    assert by_key[("comment", comment_on_answer.id)]["course_id"] == course.id
    assert by_key[("comment", reply.id)]["author_id"] == student.id
    # 不泄漏隐私字段
    assert all("password" not in item for item in items)


def test_patrol_case_creates_pending_and_dedupes(
    client: TestClient, db_session: Session
) -> None:
    """建单为 source=agent/pending（C-06 不处置）；同目标重复建单幂等 repeat。"""
    student = _create_user(db_session, "patrol_stu2", "student")
    question = Question(
        title="疑似违规问题", body="疑似违规正文", course_id=1, author_id=student.id,
    )
    db_session.add(question)
    db_session.commit()
    db_session.refresh(question)

    body = {
        "target_type": "question",
        "target_id": question.id,
        "risk_level": "high",
        "reason": "内容疑似包含辱骂攻击，建议人工复核。",
        "snapshot": "question#1 course=1 body=疑似违规正文…",
        "agent_run_id": "patrol-run-1",
    }
    resp = client.post("/internal/agent/patrol/cases", headers=SERVICE_AUTH, json=body)
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["repeat"] is False
    case = db_session.query(ModerationCase).filter(
        ModerationCase.id == data["id"]
    ).one()
    assert case.status == "pending"
    assert case.source == "agent"
    assert case.risk_level == "high"
    assert case.trace_id is not None
    # C-06：只建单，内容未被动过
    assert db_session.query(Question).filter(Question.id == question.id).one().is_hidden is False

    # 同目标重复建单：幂等 repeat（不产生第二条工单）
    resp = client.post(
        "/internal/agent/patrol/cases", headers=SERVICE_AUTH,
        json={**body, "agent_run_id": "patrol-run-2"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["repeat"] is True
    assert db_session.query(ModerationCase).count() == 1

    # 已结案（executed）后复发可再建单：终态不阻止
    case.status = "executed"
    case.resolution = "hide"
    db_session.commit()
    resp = client.post(
        "/internal/agent/patrol/cases", headers=SERVICE_AUTH,
        json={**body, "agent_run_id": "patrol-run-3"},
    )
    assert resp.json()["data"]["repeat"] is False

    # 非法目标类型/风险等级 422（Literal 校验）
    resp = client.post(
        "/internal/agent/patrol/cases", headers=SERVICE_AUTH,
        json={**body, "target_type": "user"},
    )
    # 项目全局异常处理器把请求校验错误统一转为 400 信封
    assert resp.status_code == 400

    # 未带服务 token 401
    assert client.post("/internal/agent/patrol/cases", json=body).status_code == 401
