"""可信课程词表与最小匿名学习事件。"""

import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.core.config import settings
from app.core.security import create_access_token
from app.modules.courses.models import Course, CourseMember
from app.modules.governance.models import AnonymousLearningEvent
from app.modules.identity.models import User
from app.modules.qa.models import Question, Tag


@pytest.fixture
def setup(db_session):
    users = {}
    for name, role in [("teacher", "teacher"), ("other", "teacher"), ("student", "student")]:
        user = User(username=f"learning_{name}", email=f"learning_{name}@example.com",
                    password_hash=secrets.token_hex(24), role=role)
        db_session.add(user)
        users[name] = user
    db_session.flush()
    course = Course(name="学习反馈", code="LEARNING", teacher_id=users["teacher"].id)
    db_session.add(course)
    tag = Tag(name="递归", type="custom")
    db_session.add(tag)
    db_session.flush()
    db_session.add(CourseMember(course_id=course.id, user_id=users["student"].id))
    question = Question(course_id=course.id, author_id=users["student"].id,
                        title="公开问题", body="不要写入匿名事件的私人原文")
    db_session.add(question)
    db_session.commit()
    return {**users, "course": course, "tag": tag, "question": question}


def headers(user, service=False):
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}",
            **({"X-Service-Token": settings.agent_service_token} if service else {})}


def trusted(client, setup, **patch):
    return client.put(
        f"/api/learning/courses/{setup['course'].id}/trusted-tags/{setup['tag'].id}",
        headers=headers(setup["teacher"]), json={"source": "teacher", "active": True, **patch},
    )


def event(setup, **patch):
    return {"event_id": str(uuid4()), "course_id": setup["course"].id,
            "tag_ids": [setup["tag"].id], "question_id": setup["question"].id, **patch}


def submit(client, setup, body):
    return client.post("/internal/agent/user/learning-events", json=body,
                       headers=headers(setup["student"], True))


def test_only_explicit_trusted_source_tags_are_used(client, setup):
    url = f"/internal/agent/user/courses/{setup['course'].id}/trusted-tags"
    assert client.get(url, headers=headers(setup["student"], True)).json()["data"] == []
    assert submit(client, setup, event(setup)).status_code == 400
    assert trusted(client, setup).status_code == 200
    tags = client.get(url, headers=headers(setup["student"], True)).json()["data"]
    assert tags[0]["tag_id"] == setup["tag"].id
    assert tags[0]["source"] == "teacher"


def test_maintained_sources_include_inactive_for_teacher_only(client, setup):
    assert trusted(client, setup, active=False).status_code == 200
    path = f"/api/learning/courses/{setup['course'].id}/trusted-tags"
    response = client.get(path, headers=headers(setup["teacher"]))
    assert response.status_code == 200
    assert response.json()["data"]["items"][0]["active"] is False
    assert client.get(path, headers=headers(setup["student"])).status_code == 403
    assert client.get(path, headers=headers(setup["other"])).status_code == 403


def test_anonymous_feedback_counts_deduplicated_events(client, setup):
    assert trusted(client, setup).status_code == 200
    body = event(setup)
    assert submit(client, setup, body).json()["data"]["repeat"] is False
    assert submit(client, setup, body).json()["data"]["repeat"] is True
    assert submit(client, setup, event(setup)).status_code == 200
    response = client.get(f"/api/learning/courses/{setup['course'].id}/feedback",
                          headers=headers(setup["teacher"]))
    assert response.status_code == 200
    item = response.json()["data"]["items"][0]
    assert item["count"] == 2
    assert item["summary"] == "关于“递归”的学习疑问"
    assert item["question_links"] == [f"/questions/{setup['question'].id}"]
    text = response.text
    assert "不要写入" not in text
    assert "user_id" not in text
    assert "session" not in text
    assert "username" not in text


def test_maintenance_and_feedback_respect_teacher_course(client, setup):
    url = f"/api/learning/courses/{setup['course'].id}"
    for who in ["student", "other"]:
        assert client.put(f"{url}/trusted-tags/{setup['tag'].id}",
                          headers=headers(setup[who]),
                          json={"source": "teacher", "active": True}).status_code == 403
        assert client.get(f"{url}/feedback", headers=headers(setup[who])).status_code == 403


@pytest.mark.parametrize("extra", [{"summary": "私人原话"}, {"user_id": 9}, {"history": []}])
def test_private_payload_fields_rejected(client, setup, extra):
    assert submit(client, setup, event(setup, **extra)).status_code == 400


def test_changed_payload_for_same_event_refused(client, setup):
    trusted(client, setup)
    body = event(setup)
    assert submit(client, setup, body).status_code == 200
    assert submit(client, setup, {**body, "question_id": None}).status_code == 409


def test_inactive_tag_and_hidden_question_not_disclosed(client, db_session, setup):
    trusted(client, setup)
    assert submit(client, setup, event(setup)).status_code == 200
    setup["question"].is_hidden = True
    db_session.commit()
    assert submit(client, setup, event(setup)).status_code == 400
    feed = f"/api/learning/courses/{setup['course'].id}/feedback"
    item = client.get(feed, headers=headers(setup["teacher"])).json()["data"]["items"][0]
    assert item["question_links"] == []
    assert trusted(client, setup, active=False).status_code == 200
    assert client.get(feed, headers=headers(setup["teacher"])).json()["data"]["items"] == []


def test_nonmember_or_missing_service_refused(client, db_session, setup):
    trusted(client, setup)
    response = client.post("/internal/agent/user/learning-events", json=event(setup),
                           headers=headers(setup["student"]))
    assert response.status_code == 401
    db_session.query(CourseMember).delete()
    db_session.commit()
    assert submit(client, setup, event(setup)).status_code == 403


def test_foreign_knowledge_node_refused(client, setup):
    trusted(client, setup)
    assert submit(client, setup, event(setup, knowledge_node_ids=[9999])).status_code == 400


def test_service_catalog_only_exposes_active_trusted_source_metadata(client, setup):
    url = "/internal/agent/knowledge-catalog/tags"
    assert client.get(url).status_code == 401
    assert trusted(client, setup).status_code == 200
    response = client.get(url, headers={"X-Service-Token": settings.agent_service_token})
    assert response.status_code == 200
    assert response.json()["data"] == {"items": [{
        "id": setup["tag"].id, "course_id": setup["course"].id,
        "source": "teacher", "active": True,
    }]}
    trusted(client, setup, active=False)
    data = client.get(url, headers={"X-Service-Token": settings.agent_service_token}).json()["data"]
    assert data == {"items": []}


def test_anonymous_storage_has_no_user_or_session_and_honors_lookback(client, db_session, setup):
    trusted(client, setup)
    body = event(setup)
    assert submit(client, setup, body).status_code == 200
    row = db_session.query(AnonymousLearningEvent).one()
    columns = set(AnonymousLearningEvent.__table__.columns.keys())
    assert not columns & {"user_id", "session_id", "history", "summary", "message", "memory"}
    row.created_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=8)
    db_session.commit()
    url = f"/api/learning/courses/{setup['course'].id}/feedback"
    assert client.get(url, headers=headers(setup["teacher"])).json()["data"]["items"] == []


def test_textbook_source_requires_reference(client, setup):
    assert trusted(client, setup, source="textbook").status_code == 400
    response = trusted(client, setup, source="textbook", source_ref="教材第一章#递归")
    assert response.status_code == 200


def test_cross_course_question_refused(client, db_session, setup):
    trusted(client, setup)
    other = Course(name="另一门课", code="LEARNING_OTHER", teacher_id=setup["teacher"].id)
    db_session.add(other)
    db_session.flush()
    question = Question(course_id=other.id, author_id=setup["student"].id,
                        title="另一门课程的问题", body="正文")
    db_session.add(question)
    db_session.commit()
    assert submit(client, setup, event(setup, question_id=question.id)).status_code == 400
