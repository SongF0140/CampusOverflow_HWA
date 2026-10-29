"""回答经验：教师确认课程经验，不能通过经验内容修改权限规则。"""

import re

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.courses import domain as courses_domain
from app.modules.courses import service as courses_service
from app.modules.governance import domain, repository
from app.modules.identity import service as identity_service


def _ensure_access(
    db: Session, user_id: int, course_id: int, *, teacher_only: bool = False,
) -> None:
    actor = identity_service.get_by_id(db, user_id)
    course = courses_service.get_course(db, course_id)
    if course is None:
        raise courses_domain.CourseNotFoundError()
    teacher = actor.role == "teacher" and course.teacher_id == user_id
    student = actor.role == "student" and courses_service.is_member(db, course_id, user_id)
    if actor.status != "active" or not (teacher or (student and not teacher_only)):
        raise domain.CaseActionForbiddenError("仅本课程成员可读取经验，发布审核仅限负责教师")


def _validate_content(title: str, summary: str, steps: list[str]) -> None:
    if any(not step.strip() or len(step) > 500 for step in steps):
        raise domain.CaseDecisionError("经验步骤应为 1～500 字的非空文本")
    content = "\n".join([title, summary, *steps])
    private_markers = ("原始聊天", "聊天记录", "私人记忆", "browser_memory", "private_chat")
    contacts = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)", content)
    if (domain.is_sensitive_content(content) or contacts
            or any(word in content for word in private_markers)):
        raise domain.CaseDecisionError("经验建议包含敏感信息或私人上下文，请仅保留通用回答流程")


def _existing(
    db: Session, proposal_id: str, user_id: int, course_id: int,
    title: str, summary: str, steps: list[str],
) -> dict | None:
    previous = repository.get_experience(db, proposal_id=proposal_id)
    if previous is None:
        return None
    actual = (
        previous.proposed_by, previous.course_id, previous.title, previous.summary, previous.steps,
    )
    if actual != (user_id, course_id, title, summary, steps):
        raise domain.CaseTargetNotReadyError("经验建议标识已被其他参数使用，请重新提交")
    return {**previous.model_dump(), "repeat": True}


def propose(
    db: Session, user_id: int, proposal_id: str, course_id: int, title: str,
    summary: str, steps: list[str], trace_id: str,
) -> dict:
    _ensure_access(db, user_id, course_id)
    _validate_content(title, summary, steps)
    previous = _existing(db, proposal_id, user_id, course_id, title, summary, steps)
    if previous is not None:
        return previous
    try:
        run_id = f"experience-{proposal_id}"
        repository.create_run(db, "experience_proposal", trace_id, run_id,
                              "提交课程回答流程经验建议", user_id=user_id)
        row = repository.create_experience(db, proposal_id, course_id, user_id, title,
                                           summary, steps, trace_id, run_id)
        repository.update_run(db, run_id, "succeeded", "建议已保存，等待负责教师确认", None)
        db.commit()
        return {**row.model_dump(), "repeat": False}
    except IntegrityError:
        db.rollback()
        previous = _existing(db, proposal_id, user_id, course_id, title, summary, steps)
        if previous is not None:
            return previous
        raise
    except Exception:
        db.rollback()
        raise


def review_list(db: Session, teacher_id: int, course_id: int) -> dict:
    _ensure_access(db, teacher_id, course_id, teacher_only=True)
    rows = repository.list_experiences(db, course_id)
    return {"items": [row.model_dump() for row in rows], "total": len(rows)}


def published(db: Session, user_id: int, course_id: int) -> list[dict]:
    _ensure_access(db, user_id, course_id)
    return [{"id": row.proposal_id, "course_id": row.course_id, "title": row.title,
             "summary": row.summary, "steps": row.steps, "status": "published"}
            for row in repository.list_experiences(db, course_id, published_only=True)]


def review(db: Session, teacher_id: int, row_id: int, action: str) -> dict:
    try:
        row = repository.get_experience(db, row_id=row_id, for_update=True)
        if row is None:
            raise domain.DecisionNotFoundError()
        _ensure_access(db, teacher_id, row.course_id, teacher_only=True)
        states = {"publish": ("pending", "published"), "reject": ("pending", "rejected"),
                  "withdraw": ("published", "withdrawn")}
        if action not in states:
            raise domain.CaseDecisionError("不支持的经验审核动作")
        before, after = states[action]
        if row.status == after:
            db.commit()
            return {**row.model_dump(), "repeat": True}
        if row.status != before:
            raise domain.CaseTargetNotReadyError("经验状态已变化，不能执行该审核动作")
        if action == "publish":
            _validate_content(row.title, row.summary, row.steps)
        result = repository.decide_experience(db, row.id, after, teacher_id)
        db.commit()
        return {**result.model_dump(), "repeat": False}
    except Exception:
        db.rollback()
        raise
