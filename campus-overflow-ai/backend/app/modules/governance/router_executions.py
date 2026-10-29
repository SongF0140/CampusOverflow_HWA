"""v2申请入口与人类批准入口分离；没有真实治理执行接口。"""

import hashlib
import uuid
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.permissions import UserPrincipal, require_roles
from app.db.session import get_db
from app.modules.governance import service_executions
from app.modules.governance.router_internal import AgentAdmin
from app.modules.governance.schemas import GovernanceRequestCreate
from app.modules.governance.schemas_executions import (
    GovernanceApprovalResponse,
    HumanApprovalDecision,
)

router = APIRouter(tags=["治理v2批准（尚不执行）"])
DbSession = Annotated[Session, Depends(get_db)]
HumanAdmin = Annotated[UserPrincipal, Depends(require_roles("admin"))]
BASE = "/api/governance/approval-requests"


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
