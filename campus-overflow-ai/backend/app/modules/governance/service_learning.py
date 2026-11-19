"""受控词表与匿名反馈；不得接受或持久化私人问题原文。"""

from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.courses import domain as courses_domain
from app.modules.courses import service as courses_service
from app.modules.governance import domain, repository
from app.modules.identity import service as identity_service
from app.modules.qa import service as qa_service


def _course(db: Session, course_id: int):
    course = courses_service.get_course(db, course_id)
    if course is None:
        raise courses_domain.CourseNotFoundError()
    return course


def maintain_source(
    db: Session, user_id: int, course_id: int, tag_id: int, source: str,
    active: bool, source_ref: str | None,
) -> dict:
    actor = identity_service.get_by_id(db, user_id)
    course = _course(db, course_id)
    if actor.role != "admin" and not (actor.role == "teacher" and course.teacher_id == user_id):
        raise domain.CaseActionForbiddenError("仅负责教师或管理员可维护课程词表")
    qa_service.get_tag_detail(db, tag_id)
    if source == "textbook" and not (source_ref or "").strip():
        raise domain.CaseDecisionError("教材来源必须注明教材或书签依据")
    result = repository.save_trusted_tag_source(
        db, course_id, tag_id, source, active, source_ref, user_id,
    )
    db.commit()
    return result.model_dump()


def list_trusted_tags(db: Session, course_id: int) -> list[dict]:
    _course(db, course_id)
    tags = {tag.id: tag for tag in qa_service.list_tags(db, None, False)}
    return [
        {"id": item.tag_id, "tag_id": item.tag_id, "course_id": course_id,
         "name": tags[item.tag_id].name, "source": item.source, "active": True}
        for item in repository.list_trusted_tag_sources(db, course_id)
        if item.active and item.tag_id in tags
    ]


def managed_tag_sources(db: Session, user_id: int, course_id: int) -> dict:
    actor = identity_service.get_by_id(db, user_id)
    course = _course(db, course_id)
    if actor.role != "admin" and not (actor.role == "teacher" and course.teacher_id == user_id):
        raise domain.CaseActionForbiddenError("仅负责教师或管理员可维护课程词表")
    tags = {tag.id: tag for tag in qa_service.list_tags(db, None, False)}
    return {"items": [{**item.model_dump(), "name": tags[item.tag_id].name}
                      for item in repository.list_trusted_tag_sources(db, course_id)
                      if item.tag_id in tags]}


def catalog_tag_sources(db: Session) -> dict:
    return {"items": [
        {"id": item.tag_id, "course_id": item.course_id, "source": item.source, "active": True}
        for item in repository.list_trusted_tag_sources(db) if item.active
    ]}


def _visible_question(db: Session, question_id: int, course_id: int) -> bool:
    snapshot = qa_service.moderation_get_snapshot(db, "question", question_id)
    return snapshot["state"] == "ready" and snapshot.get("course_id") == course_id


def record_event(
    db: Session, user_id: int, event_id: str, course_id: int,
    tag_ids: list[int], node_ids: list[int], question_id: int | None,
) -> dict:
    actor = identity_service.get_by_id(db, user_id)
    _course(db, course_id)
    if actor.role != "student" or not courses_service.is_member(db, course_id, user_id):
        raise domain.CaseActionForbiddenError("仅已加入课程的学生可提交学习反馈")
    tags, nodes = sorted(set(tag_ids)), sorted(set(node_ids))
    expected = (course_id, tags, nodes, question_id)

    def existing_result() -> dict | None:
        previous = repository.get_learning_event(db, event_id)
        if previous is None:
            return None
        actual = (previous.course_id, previous.tag_ids, previous.knowledge_node_ids,
                  previous.question_id)
        if actual != expected:
            raise domain.CaseTargetNotReadyError("学习事件标识已被其他参数使用")
        return {"event_id": event_id, "repeat": True}

    previous = existing_result()
    if previous is not None:
        return previous
    allowed = {tag["tag_id"] for tag in list_trusted_tags(db, course_id)}
    if not tags or not set(tags).issubset(allowed):
        raise domain.CaseDecisionError("标签不属于当前课程有效教材或教师词表")
    current_nodes = {node.id for node in courses_service.get_knowledge_tree(db, course_id).nodes}
    if not set(nodes).issubset(current_nodes):
        raise domain.CaseDecisionError("知识点不属于当前课程")
    if question_id is not None and not _visible_question(db, question_id, course_id):
        raise domain.CaseDecisionError("原题不属于当前课程或已不可见")
    try:
        repository.create_learning_event(db, event_id, course_id, tags, nodes, question_id)
        db.commit()
    except IntegrityError:
        db.rollback()
        previous = existing_result()
        if previous is not None:
            return previous
        raise
    return {"event_id": event_id, "repeat": False}


def learning_feedback(db: Session, course_id: int, days: int = 7) -> dict:
    trusted = {tag["tag_id"]: tag for tag in list_trusted_tags(db, course_id)}
    current_nodes = {node.id for node in courses_service.get_knowledge_tree(db, course_id).nodes}
    since = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=days)
    groups: dict[int, dict] = {}
    for event in repository.list_learning_events(db, course_id, since):
        for tag_id in set(event.tag_ids) & trusted.keys():
            group = groups.setdefault(tag_id, {"count": 0, "nodes": set(), "questions": set()})
            group["count"] += 1
            group["nodes"].update(set(event.knowledge_node_ids) & current_nodes)
            if (event.question_id is not None
                    and _visible_question(db, event.question_id, course_id)):
                group["questions"].add(event.question_id)
    return {"course_id": course_id, "items": [
        {"tag_id": tag_id, "tag_name": trusted[tag_id]["name"],
         "summary": f"关于“{trusted[tag_id]['name']}”的学习疑问", "count": group["count"],
         "knowledge_node_ids": sorted(group["nodes"]),
         "question_links": [f"/questions/{qid}" for qid in sorted(group["questions"])]}
        for tag_id, group in sorted(groups.items(), key=lambda item: (-item[1]["count"], item[0]))
    ]}


def teacher_feedback(db: Session, user_id: int, course_id: int, days: int) -> dict:
    actor = identity_service.get_by_id(db, user_id)
    course = _course(db, course_id)
    if actor.role != "admin" and (actor.role != "teacher" or course.teacher_id != user_id):
        raise domain.CaseActionForbiddenError("仅负责教师可读取本课程匿名学习反馈")
    return learning_feedback(db, course_id, days)
