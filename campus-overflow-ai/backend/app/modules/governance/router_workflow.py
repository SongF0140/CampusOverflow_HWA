"""系统巡检内部根任务入口，不注册到普通Agent或外部MCP。"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.response import ok
from app.db.session import get_db
from app.modules.governance import service_workflow
from app.modules.governance.router_internal import ServiceAuth
from app.modules.governance.schemas_workflow import PatrolWorkflowCreate

router = APIRouter(prefix="/internal/agent/patrol/workflow-tasks", tags=["系统巡检根任务"])
DbSession = Annotated[Session, Depends(get_db)]


def enabled(trace_id: ServiceAuth) -> str:
    if not settings.governance_workflow_enabled:
        raise HTTPException(503, "系统巡检工作流尚未启用")
    if len(trace_id) > 64:
        raise HTTPException(400, "追踪标识过长")
    return trace_id


WorkflowAuth = Annotated[str, Depends(enabled)]


@router.post("")
def create(request: PatrolWorkflowCreate, trace_id: WorkflowAuth, db: DbSession):
    return ok(service_workflow.create_task(db, request, trace_id).model_dump(mode="json"))


@router.get("/{task_id}")
def read(task_id: UUID, _trace: WorkflowAuth, db: DbSession):
    result = service_workflow.read_task(db, str(task_id))
    if result is None:
        raise HTTPException(404, "巡检根任务不存在")
    return ok(result.model_dump(mode="json"))
