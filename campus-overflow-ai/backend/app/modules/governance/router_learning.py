"""学习事件内部白名单与课程词表/匿名反馈管理入口。"""

from typing import Annotated

from fastapi import APIRouter, Path, Query

from app.core.permissions import CurrentUser
from app.core.response import ok
from app.modules.governance import service_learning
from app.modules.governance.router_internal import DbSession, ServiceAuth
from app.modules.governance.schemas_learning import LearningEventCreate, TrustedTagUpdate
from app.modules.qa import service as qa_service

router = APIRouter(tags=["可信词表与匿名学习反馈"])
PositiveId = Annotated[int, Path(ge=1)]


@router.get("/internal/agent/knowledge-catalog/tags")
def catalog_tag_sources(_service: ServiceAuth, db: DbSession) -> dict:
    return ok(service_learning.catalog_tag_sources(db))


@router.get("/internal/agent/user/certified-answers/{answer_id}")
def certified_answer_link(
    answer_id: PositiveId, _service: ServiceAuth, user: CurrentUser, db: DbSession,
) -> dict:
    return ok(qa_service.get_certified_answer_link(db, answer_id))


@router.put("/api/learning/courses/{course_id}/trusted-tags/{tag_id}")
def maintain_source(
    course_id: PositiveId, tag_id: PositiveId, req: TrustedTagUpdate,
    user: CurrentUser, db: DbSession,
) -> dict:
    return ok(service_learning.maintain_source(
        db, user.id, course_id, tag_id, req.source, req.active, req.source_ref,
    ))


@router.get("/api/learning/courses/{course_id}/trusted-tags")
def managed_sources(course_id: PositiveId, user: CurrentUser, db: DbSession) -> dict:
    return ok(service_learning.managed_tag_sources(db, user.id, course_id))


@router.get("/internal/agent/user/courses/{course_id}/trusted-tags")
def trusted_tags(
    course_id: PositiveId, _service: ServiceAuth, user: CurrentUser, db: DbSession,
) -> dict:
    return ok(service_learning.list_trusted_tags(db, course_id))


@router.post("/internal/agent/user/learning-events")
def learning_event(
    req: LearningEventCreate, _service: ServiceAuth, user: CurrentUser, db: DbSession,
) -> dict:
    return ok(service_learning.record_event(
        db, user.id, str(req.event_id), req.course_id, req.tag_ids,
        req.knowledge_node_ids, req.question_id,
    ))


@router.get("/internal/agent/learning-feedback/{course_id}")
def internal_feedback(
    course_id: PositiveId, _service: ServiceAuth, db: DbSession,
    days: Annotated[int, Query(ge=1, le=31)] = 7,
) -> dict:
    return ok(service_learning.learning_feedback(db, course_id, days))


@router.get("/api/learning/courses/{course_id}/feedback")
def teacher_feedback(
    course_id: PositiveId, user: CurrentUser, db: DbSession,
    days: Annotated[int, Query(ge=1, le=31)] = 7,
) -> dict:
    return ok(service_learning.teacher_feedback(db, user.id, course_id, days))
