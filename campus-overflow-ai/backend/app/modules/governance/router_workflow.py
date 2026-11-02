"""系统巡检内部根任务入口，不注册到普通Agent或外部MCP。"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.response import ok
from app.db.session import get_db
from app.modules.governance import (
    service_execution_jobs,
    service_workflow,
    service_workflow_proposals,
)
from app.modules.governance.router_executions import ExecutorAuth
from app.modules.governance.router_internal import ServiceAuth
from app.modules.governance.schemas_workflow import (
    PatrolWorkflowCreate,
    WorkflowBind,
    WorkflowFinish,
    WorkflowProposal,
)

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


@router.get("")
def unbound(_trace: WorkflowAuth, db: DbSession):
    return ok(
        {"items": [task.model_dump(mode="json") for task in service_workflow.unbound_tasks(db)]}
    )


@router.post("/{task_id}/bind")
def bind(task_id: UUID, req: WorkflowBind, _trace: WorkflowAuth, db: DbSession):
    return ok(
        service_workflow.bind_task(db, str(task_id), req.workflow_run_id).model_dump(mode="json")
    )


@router.post("/{task_id}/finish")
def finish(task_id: UUID, req: WorkflowFinish, _trace: WorkflowAuth, db: DbSession):
    return ok(
        service_workflow.finish_task(db, str(task_id), req.status, req.reason).model_dump(
            mode="json"
        )
    )


@router.get("/{task_id}/observe")
def observe(task_id: UUID, _trace: WorkflowAuth, db: DbSession):
    return ok(service_workflow.observe_task(db, str(task_id)))


@router.post("/{task_id}/proposals")
def propose(task_id: UUID, req: WorkflowProposal, _trace: WorkflowAuth, db: DbSession):
    return ok(
        service_workflow_proposals.create_proposal(db, str(task_id), req).model_dump(mode="json")
    )


@router.get("/{task_id}/proposals/{request_id}")
def proposal(task_id: UUID, request_id: UUID, _trace: WorkflowAuth, db: DbSession):
    return ok(
        service_workflow_proposals.read_proposal(db, str(task_id), str(request_id)).model_dump(
            mode="json"
        )
    )


@router.post("/{task_id}/proposals/{request_id}/claim")
def claim(
    task_id: UUID, request_id: UUID, _trace: WorkflowAuth, _executor: ExecutorAuth, db: DbSession
):
    item = service_workflow_proposals.read_proposal(db, str(task_id), str(request_id))
    result = (
        service_execution_jobs.claim(
            db, workflow_task_id=str(task_id), execution_id=item.execution_id
        )
        if item.execution_id
        else None
    )
    return ok(result.model_dump(mode="json") if result else None)
