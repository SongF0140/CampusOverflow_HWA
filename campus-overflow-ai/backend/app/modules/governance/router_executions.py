"""人类批准与执行分离；执行器只能使用绑定任务的有效租约。"""

import hashlib
import secrets
import uuid
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permissions import UserPrincipal, require_roles
from app.core.response import ok
from app.db.session import get_db
from app.modules.governance import (
    service_execution_actions,
    service_execution_jobs,
    service_executions,
)
from app.modules.governance.router_internal import AgentAdmin, ServiceAuth
from app.modules.governance.schemas import GovernanceRequestCreate
from app.modules.governance.schemas_executions import (
    ExecutionClaimResponse,
    ExecutionCommand,
    ExecutionReport,
    ExecutionResponse,
    ExecutionStatusResponse,
    GovernanceApprovalResponse,
    HumanApprovalDecision,
)

router = APIRouter(tags=["治理v2批准与受控执行"])
DbSession = Annotated[Session, Depends(get_db)]
HumanAdmin = Annotated[UserPrincipal, Depends(require_roles("admin"))]
BASE = "/api/governance/approval-requests"
EXECUTIONS = "/internal/agent/governance-executions"


def require_executor(
    _service: ServiceAuth,
    executor_token: Annotated[str | None, Header(alias="X-Executor-Token")] = None,
) -> None:
    configured = settings.governance_executor_token
    if (
        not configured
        or configured == settings.agent_service_token
        or not executor_token
        or not secrets.compare_digest(executor_token.encode(), configured.encode())
    ):
        raise HTTPException(401, "执行器凭证缺失或无效")


ExecutorAuth = Annotated[None, Depends(require_executor)]


@router.post(EXECUTIONS + "/claim", response_model=ExecutionClaimResponse)
def claim(_executor: ExecutorAuth, db: DbSession):
    return ExecutionClaimResponse(data=service_execution_jobs.claim(db))


@router.post(EXECUTIONS + "/{execution_id}/report")
def report(
    execution_id: UUID, req: ExecutionReport, _executor: ExecutorAuth, db: DbSession,
    lease: Annotated[str | None, Header(alias="X-Execution-Lease")] = None,
):
    return ok(service_execution_jobs.report(db, str(execution_id), lease, req))


@router.post(EXECUTIONS + "/{execution_id}/execute", response_model=ExecutionResponse)
def execute(
    execution_id: UUID,
    req: ExecutionCommand,
    _executor: ExecutorAuth,
    db: DbSession,
    lease: Annotated[str | None, Header(alias="X-Execution-Lease")] = None,
):
    return ExecutionResponse(
        data=service_execution_actions.execute(
            db,
            str(execution_id),
            lease,
            req.lease_epoch,
        )
    )


@router.get(EXECUTIONS + "/{execution_id}", response_model=ExecutionStatusResponse)
def read_execution(
    execution_id: UUID,
    _executor: ExecutorAuth,
    db: DbSession,
    epoch: Annotated[int, Header(alias="X-Execution-Epoch", gt=0)],
    lease: Annotated[str | None, Header(alias="X-Execution-Lease")] = None,
):
    return ExecutionStatusResponse(
        data=service_execution_actions.read(
            db,
            str(execution_id),
            lease,
            epoch,
        )
    )


@router.post(
    "/internal/agent/user/governance-requests/v2",
    response_model=GovernanceApprovalResponse,
)
def create_request(
    request: Request,
    req: GovernanceRequestCreate,
    admin: AgentAdmin,
    db: DbSession,
):
    key = request.headers.get("x-external-agent-key")
    result = service_executions.create_request(
        db,
        admin.id,
        req,
        request.headers.get("x-trace-id", "").strip() or uuid.uuid4().hex,
        source_key_hash=hashlib.sha256(key.encode()).hexdigest() if key else None,
    )
    return GovernanceApprovalResponse(data=result)


@router.get(BASE + "/{request_id}", response_model=GovernanceApprovalResponse)
def read_request(request_id: UUID, admin: HumanAdmin, db: DbSession):
    return GovernanceApprovalResponse(
        data=service_executions.read_request(db, admin.id, str(request_id)),
    )


@router.get("/internal/agent/user/governance-requests/v2/{request_id}",
            response_model=GovernanceApprovalResponse)
def read_internal_request(request_id: UUID, admin: AgentAdmin, db: DbSession):
    return GovernanceApprovalResponse(
        data=service_executions.read_request(db, admin.id, str(request_id)),
    )


@router.post(BASE + "/{request_id}/approve", response_model=GovernanceApprovalResponse)
def approve(request_id: UUID, req: HumanApprovalDecision, admin: HumanAdmin, db: DbSession):
    return GovernanceApprovalResponse(
        data=service_executions.decide_request(
            db,
            admin.id,
            str(request_id),
            req,
            approve=True,
        )
    )


@router.post(BASE + "/{request_id}/reject", response_model=GovernanceApprovalResponse)
def reject(request_id: UUID, req: HumanApprovalDecision, admin: HumanAdmin, db: DbSession):
    return GovernanceApprovalResponse(
        data=service_executions.decide_request(
            db,
            admin.id,
            str(request_id),
            req,
            approve=False,
        )
    )
