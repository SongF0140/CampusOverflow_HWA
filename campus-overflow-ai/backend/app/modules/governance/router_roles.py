from typing import Literal
from uuid import UUID

from fastapi import APIRouter

from app.core.permissions import CurrentUser
from app.core.response import ok
from app.modules.governance import service_roles
from app.modules.governance.router_internal import DbSession, ServiceAuth
from app.modules.governance.schemas_roles import ClassChangeCreate

router = APIRouter(tags=["教师确认班级变更"])


@router.post("/internal/agent/user/class-changes")
def propose(req: ClassChangeCreate, trace: ServiceAuth, user: CurrentUser, db: DbSession) -> dict:
    return ok(service_roles.propose(db, user.id, str(req.request_id), req.course_id,
                                    req.student_ids, req.action, trace))


@router.get("/internal/agent/user/class-changes/{request_id}")
def read(request_id: UUID, _service: ServiceAuth, user: CurrentUser, db: DbSession) -> dict:
    return ok(service_roles.operate(db, user.id, str(request_id), "read"))


@router.get("/api/class-changes/{request_id}")
def preview(request_id: UUID, user: CurrentUser, db: DbSession) -> dict:
    return ok(service_roles.operate(db, user.id, str(request_id), "read"))


@router.post("/api/class-changes/{request_id}/{operation}")
def confirm(
    request_id: UUID, operation: Literal["confirm", "cancel"], user: CurrentUser, db: DbSession,
) -> dict:
    return ok(service_roles.operate(db, user.id, str(request_id), operation))
