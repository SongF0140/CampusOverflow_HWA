"""GL-01：版本化冻结调用、人工决定和最小公开状态。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.governance.schemas import GovernanceRequestCreate


class FrozenGovernanceCall(GovernanceRequestCreate):
    contract: Literal["approval-v2"] = "approval-v2"
    tool_name: Literal["executeApprovedGovernance"] = "executeApprovedGovernance"
    requester_id: int = Field(gt=0)


class HumanApprovalDecision(BaseModel):
    model_config = {"extra": "forbid", "str_strip_whitespace": True}
    args_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    note: str = Field(min_length=1, max_length=500)


class GovernanceApprovalOut(BaseModel):
    model_config = {"from_attributes": True}
    request_id: str
    case_id: int
    contract_version: Literal[2] = 2
    requester_id: int
    source_kind: Literal["admin", "platform"]
    frozen_call: FrozenGovernanceCall
    args_hash: str
    status: Literal[
        "pending",
        "approved",
        "executed",
        "rejected",
        "cancelled",
        "expired",
        "invalidated",
        "blocked",
    ]
    approved_by: int | None = None
    approved_at: datetime | None = None
    expires_at: datetime
    execution_id: str | None = None
    executed: bool = False
    trace_id: str
    agent_run_id: str


class GovernanceApprovalRecord(GovernanceApprovalOut):
    """仅后端仓储使用；来源凭证指纹不进入公开响应。"""

    source_key_hash: str | None = None
    review_note: str | None = None


class GovernanceApprovalResponse(BaseModel):
    code: Literal[200] = 200
    data: GovernanceApprovalOut
    message: str = "审批状态已保存，尚未执行治理"
