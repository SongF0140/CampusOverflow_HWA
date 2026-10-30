"""GL-01：版本化冻结调用、人工决定和最小公开状态。"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_serializer

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
    execution_state: str | None = None
    continuation: dict | None = None
    trace_id: str
    agent_run_id: str

    @field_serializer("approved_at", "expires_at")
    def utc_timestamps(self, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=UTC) if value is not None else None


class GovernanceApprovalRecord(GovernanceApprovalOut):
    """仅后端仓储使用；来源凭证指纹不进入公开响应。"""

    source_key_hash: str | None = None
    review_note: str | None = None


class GovernanceApprovalResponse(BaseModel):
    code: Literal[200] = 200
    data: GovernanceApprovalOut
    message: str = "审批状态已确认"


class ExecutionCommand(BaseModel):
    model_config = {"extra": "forbid"}
    lease_epoch: int = Field(gt=0, strict=True)


class GovernanceExecutionReceipt(BaseModel):
    model_config = {"extra": "forbid"}
    execution_id: str
    request_id: str
    case_id: int
    args_hash: str
    target_type: Literal["question", "answer", "comment", "user"]
    target_id: int
    action: Literal["hide", "delete", "warn", "ban", "ban_temp"]
    approved_by: int
    executed: Literal[True] = True
    committed_at: datetime
    trace_id: str
    agent_run_id: str


class GovernanceJobRecord(BaseModel):
    """只在后端使用，不向模型或普通用户返回租约哈希。"""

    model_config = {"from_attributes": True}
    execution_id: str
    request_id: str
    state: str
    lease_hash: str | None
    lease_epoch: int
    lease_expires_at: datetime | None
    result: dict | None
    continuation: dict | None = None


class ExecutionReport(ExecutionCommand):
    outcome: Literal["completed", "result_unknown", "failed"]


class ExecutionClaim(BaseModel):
    execution_id: str
    request_id: str
    case_id: int
    approved_by: int
    lease: str
    lease_epoch: int
    args_hash: str
    frozen_call: FrozenGovernanceCall
    trace_id: str


class ExecutionClaimResponse(BaseModel):
    code: Literal[200] = 200
    data: ExecutionClaim | None
    message: str = "执行任务领取完成"


class ExecutionStatusOut(BaseModel):
    execution_id: str
    state: str
    executed: bool
    receipt: GovernanceExecutionReceipt | None


class ExecutionResponse(BaseModel):
    code: Literal[200] = 200
    data: GovernanceExecutionReceipt
    message: str = "后端治理已执行，回执已保存"


class ExecutionStatusResponse(BaseModel):
    code: Literal[200] = 200
    data: ExecutionStatusOut
    message: str = "执行状态已核对"
