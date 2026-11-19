from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class ClassChangeCreate(BaseModel):
    model_config = {"extra": "forbid"}
    request_id: UUID
    course_id: int = Field(gt=0, strict=True)
    student_ids: list[Annotated[int, Field(gt=0, strict=True)]] = Field(min_length=1, max_length=50)
    action: Literal["add", "remove"]

    @model_validator(mode="after")
    def check_students(self):
        if any(type(item) is not int or item <= 0 for item in self.student_ids):
            raise ValueError("学生 ID 必须为正整数")
        if len(set(self.student_ids)) != len(self.student_ids):
            raise ValueError("学生清单不能重复")
        self.student_ids.sort()
        return self


class ClassChangeOut(BaseModel):
    model_config = {"from_attributes": True}
    request_id: str
    teacher_id: int
    course_id: int
    action: str
    snapshot: dict
    status: str
    trace_id: str
    expires_at: datetime
