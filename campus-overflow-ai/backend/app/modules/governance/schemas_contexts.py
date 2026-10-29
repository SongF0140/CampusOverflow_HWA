from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.modules.governance import domain


class StrictContext(BaseModel):
    model_config = {"extra": "forbid"}


class MemoryEntry(StrictContext):
    id: UUID
    content: str = Field(min_length=1, max_length=500)
    created_at: datetime

    @field_validator("content")
    @classmethod
    def safe_content(cls, value):
        if domain.is_sensitive_content(value):
            raise ValueError("记忆包含敏感内容，拒绝保存")
        return value


class MemoryDocument(StrictContext):
    version: int = Field(ge=0, strict=True)
    entries: list[MemoryEntry] = Field(max_length=50)


class ContextMessage(StrictContext):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=20_000)


class SessionCreate(StrictContext):
    title: str = Field(min_length=1, max_length=36)
    messages: list[ContextMessage] = Field(max_length=100)
    import_key: UUID | None = None


class SessionWrite(StrictContext):
    version: int = Field(ge=1, strict=True)
    title: str = Field(min_length=1, max_length=36)
    messages: list[ContextMessage] = Field(max_length=100)


class SessionDocument(SessionWrite):
    id: UUID
    import_key: UUID | None = None
    deleted: bool = False
