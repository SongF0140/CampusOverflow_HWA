"""TW-02：学生优质回答的教师/助教来源认证。"""

import secrets

import pytest

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.courses.models import Course
from app.modules.identity.models import User
from app.modules.qa.models import Answer, Question


@pytest.fixture
def setup(db_session):
    users = {}
    for name, role, extra in [
        ("teacher", "teacher", {}), ("other_teacher", "teacher", {}),
        ("assistant", "student", {
            "identity_type": "postgraduate", "assistant_cert_status": "approved",
        }),
        ("student", "student", {}), ("admin", "admin", {}),
    ]:
        user = User(username=f"cert_{name}", email=f"cert_{name}@example.com",
                    password_hash=secrets.token_hex(24), role=role, **extra)
        db_session.add(user)
        users[name] = user
    db_session.flush()
    course = Course(name="认证课程", code="CERT", teacher_id=users["teacher"].id)
    db_session.add(course)
    db_session.flush()
    question = Question(course_id=course.id, author_id=users["student"].id,
                        title="学生问题", body="问题正文")
    db_session.add(question)
    db_session.flush()
    answer = Answer(question_id=question.id, author_id=users["student"].id, body="学生解答")
    db_session.add(answer)
    db_session.commit()
    return {**users, "course": course, "question": question, "answer": answer}


def auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}


def certify(client, setup, who="assistant", *, cancel=False):
    method = client.delete if cancel else client.post
    return method(f"/api/answers/{setup['answer'].id}/certify", headers=auth(setup[who]))


def test_assistant_can_certify_without_joining_course(client, db_session, setup):
    response = certify(client, setup)
    assert response.status_code == 200
    assert response.json()["data"]["certified_by_assistant"] is True
    db_session.expire_all()
    answer = db_session.get(Answer, setup["answer"].id)
    assert answer.certified_by_assistant is True
    assert answer.recommended_by_assistant is False
    question = db_session.get(Question, setup["question"].id)
    assert question.accepted_answer_id is None
    assert question.status == "published"
    listing = client.get(f"/api/questions/{question.id}/answers", headers=auth(setup["student"]))
    assert listing.json()["data"]["items"][0]["certified_by_assistant"] is True


def test_sources_coexist_and_cancel_independently(client, db_session, setup):
    assert certify(client, setup, "teacher").status_code == 200
    assert certify(client, setup).status_code == 200
    assert certify(client, setup, cancel=True).status_code == 200
    db_session.expire_all()
    answer = db_session.get(Answer, setup["answer"].id)
    assert answer.certified_by_teacher is True
    assert answer.certified_by_assistant is False
    assert certify(client, setup).status_code == 200
    assert certify(client, setup, "teacher", cancel=True).status_code == 200
    db_session.expire_all()
    assert answer.certified_by_teacher is False
    assert answer.certified_by_assistant is True


@pytest.mark.parametrize("who", ["student", "other_teacher"])
def test_ineligible_actor_refused(client, setup, who):
    assert certify(client, setup, who).status_code == 403


@pytest.mark.parametrize("field,value", [
    ("identity_type", "undergraduate"), ("assistant_cert_status", "rejected"), ("status", "banned"),
])
def test_current_assistant_eligibility_is_required(client, db_session, setup, field, value):
    headers = auth(setup["assistant"])
    setattr(setup["assistant"], field, value)
    db_session.commit()
    response = client.post(f"/api/answers/{setup['answer'].id}/certify", headers=headers)
    assert response.status_code == 403


@pytest.mark.parametrize("target", ["question", "answer"])
def test_hidden_context_refused(client, db_session, setup, target):
    setup[target].is_hidden = True
    db_session.commit()
    assert certify(client, setup).status_code == 404


def test_only_student_authored_answers_can_be_certified(client, db_session, setup):
    setup["answer"].author_id = setup["teacher"].id
    db_session.commit()
    assert certify(client, setup).status_code == 403
    assert certify(client, setup, "teacher").status_code == 403


def test_repeated_certification_is_idempotent(client, db_session, setup):
    assert certify(client, setup).status_code == 200
    assert certify(client, setup).status_code == 200
    assert certify(client, setup, cancel=True).status_code == 200
    assert certify(client, setup, cancel=True).status_code == 200
    db_session.expire_all()
    assert db_session.get(Answer, setup["answer"].id).certified_by_assistant is False


def test_assistant_cannot_certify_own_answer(client, db_session, setup):
    setup["answer"].author_id = setup["assistant"].id
    db_session.commit()
    assert certify(client, setup).status_code == 403
    assert certify(client, setup, cancel=True).status_code == 403


def test_certified_link_is_checked_against_current_database(client, db_session, setup):
    assert certify(client, setup).status_code == 200
    link = f"/internal/agent/user/certified-answers/{setup['answer'].id}"
    headers = {**auth(setup["student"]), "X-Service-Token": settings.agent_service_token}
    result = client.get(link, headers=headers)
    assert result.status_code == 200
    assert result.json()["data"] == {
        "certified": True, "visible": True, "course_id": setup["course"].id,
        "question_id": setup["question"].id, "answer_id": setup["answer"].id,
        "url": f"/questions/{setup['question'].id}#answer-{setup['answer'].id}",
    }
    assert client.get(link, headers=auth(setup["student"])).status_code == 401
    assert certify(client, setup, cancel=True).status_code == 200
    assert client.get(link, headers=headers).json()["data"]["certified"] is False
    setup["question"].is_hidden = True
    db_session.commit()
    assert client.get(link, headers=headers).status_code == 404
