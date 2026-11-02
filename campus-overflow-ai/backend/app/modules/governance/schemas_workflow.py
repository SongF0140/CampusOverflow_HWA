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
