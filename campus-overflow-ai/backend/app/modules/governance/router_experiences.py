"""课程回答经验建议与负责教师确认入口。"""

from typing import Annotated, Literal

from fastapi import APIRouter, Path

from app.core.permissions import CurrentUser
from app.core.response import ok
from app.modules.governance import service_experiences
from app.modules.governance.router_internal import AgentActor, DbSession, ServiceAuth
from app.modules.governance.schemas_experiences import ExperienceProposalCreate

router = APIRouter(tags=["回答流程经验"])
PositiveId = Annotated[int, Path(ge=1)]


@router.post("/internal/agent/user/experience-proposals")
def propose(
    req: ExperienceProposalCreate, trace_id: ServiceAuth, user: AgentActor, db: DbSession,
) -> dict:
    return ok(service_experiences.propose(
        db, user.id, str(req.proposal_id), req.course_id, req.title,
        req.summary, req.steps, trace_id,
    ), "建议已保存，等待负责教师确认")


@router.get("/internal/agent/user/courses/{course_id}/experiences")
def published(
    course_id: PositiveId, _service: ServiceAuth, user: AgentActor, db: DbSession,
) -> dict:
    return ok(service_experiences.published(db, user.id, course_id))


@router.get("/api/agent-experiences/courses/{course_id}/proposals")
def review_list(course_id: PositiveId, user: CurrentUser, db: DbSession) -> dict:
    return ok(service_experiences.review_list(db, user.id, course_id))


@router.post("/api/agent-experiences/{experience_id}/{action}")
def review(
    experience_id: PositiveId, action: Literal["publish", "reject", "withdraw"],
    user: CurrentUser, db: DbSession,
) -> dict:
    return ok(service_experiences.review(db, user.id, experience_id, action), "经验状态已更新")
