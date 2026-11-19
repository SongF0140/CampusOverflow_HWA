"""课程回答流程经验：建议与教师发布严格分离。"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class ExperienceProposalCreate(BaseModel):
    model_config = {"extra": "forbid", "str_strip_whitespace": True}

    proposal_id: UUID
    course_id: int = Field(gt=0, strict=True)
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=1000)
    steps: list[str] = Field(min_length=1, max_length=12)


class ExperienceOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    proposal_id: str
    course_id: int
    proposed_by: int
    title: str
    summary: str
    steps: list[str]
    status: Literal["pending", "published", "rejected", "withdrawn"]
    trace_id: str
    agent_run_id: str
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    created_at: datetime
