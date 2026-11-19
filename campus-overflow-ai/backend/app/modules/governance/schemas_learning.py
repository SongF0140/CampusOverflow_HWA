"""可信词表来源与匿名学习反馈边界；不接受自由私人原文。"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

PositiveId = Annotated[int, Field(gt=0, strict=True)]


class TrustedTagUpdate(BaseModel):
    model_config = {"extra": "forbid", "str_strip_whitespace": True}
    source: Literal["teacher", "textbook"]
    active: bool = True
    source_ref: str | None = Field(None, max_length=500)


class TrustedTagSourceOut(BaseModel):
    model_config = {"from_attributes": True}
    course_id: int
    tag_id: int
    source: Literal["teacher", "textbook"]
    active: bool
    source_ref: str | None


class LearningEventCreate(BaseModel):
    model_config = {"extra": "forbid"}
    event_id: UUID
    course_id: int = Field(gt=0, strict=True)
    tag_ids: list[PositiveId] = Field(min_length=1, max_length=10)
    knowledge_node_ids: list[PositiveId] = Field(default_factory=list, max_length=10)
    question_id: int | None = Field(None, gt=0, strict=True)


class LearningEventOut(BaseModel):
    model_config = {"from_attributes": True}
    event_id: str
    course_id: int
    tag_ids: list[int]
    knowledge_node_ids: list[int]
    question_id: int | None
    created_at: datetime
