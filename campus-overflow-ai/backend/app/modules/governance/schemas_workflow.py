"""根任务范围由后端绑定，不接收调用者身份或执行参数。"""
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PatrolWorkflowCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_type: Literal["question", "answer", "comment"]
    target_id: int = Field(gt=0, strict=True)


class PatrolWorkflowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    task_id: UUID
    source_kind: Literal["system_patrol"]
    target_type: Literal["question", "answer", "comment"]
    target_id: int
    initial_version: str
    trace_id: str
    agent_run_id: str
    created_at: datetime
    repeat: bool = False
    status: Literal["active", "completed", "needs_human", "cancelled"] = "active"
    workflow_run_id: str | None = None
    stop_reason: str | None = None


class WorkflowProposal(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    request_id: UUID
    round: int = Field(ge=1, le=5, strict=True)
    action: Literal["hide", "delete", "warn", "ban", "ban_temp"]
    reason: str = Field(min_length=1, max_length=500)
    expected_version: str = Field(pattern=r"^[a-f0-9]{64}$")
    duration_days: int | None = Field(default=None, ge=1, le=30, strict=True)


class WorkflowFinish(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["completed", "needs_human", "cancelled"]
    reason: str = Field(pattern=r"^[a-z_]{1,100}$")


class WorkflowBind(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workflow_run_id: str = Field(pattern=r"^wrun_[A-Za-z0-9_-]{1,90}$")
