import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.modules.governance import domain


class StrictContext(BaseModel):
    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def no_credentials(self):
        pattern = (
            r"(?i)(bearer\s+\S+|(?:password|api_key|token|密码|密钥)\s*[:=：]\s*\S+"
            r"|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b|sk-[A-Za-z0-9_-]{16,})"
        )
        if any(
            isinstance(value, str) and re.search(pattern, value) for value in self.__dict__.values()
        ):
            raise ValueError("私人上下文包含敏感凭证，拒绝保存")
        return self


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
