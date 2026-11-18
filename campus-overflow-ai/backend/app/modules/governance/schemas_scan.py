"""管理员全量扫描任务 Schema（P2）：只含进度与计数，不含正文、作者或处置字段。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ScanTargetType = Literal["question", "answer", "comment"]
ScanStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
ProgressStatus = Literal["running", "succeeded", "failed"]

SCAN_TARGET_TYPES: tuple[str, ...] = ("question", "answer", "comment")


class PatrolScanCreateRequest(BaseModel):
    """创建扫描任务：target_types 缺省为全部三类。"""

    model_config = {"extra": "forbid"}

    target_types: list[ScanTargetType] | None = Field(default=None, min_length=1, max_length=3)
    created_by: int | None = Field(default=None, ge=1)


class PatrolScanProgressRequest(BaseModel):
    """按批回写进度：计数均为增量，游标为空表示本批无内容。"""

    model_config = {"extra": "forbid"}

    cursor_type: ScanTargetType | None = None
    cursor_id: int | None = Field(default=None, ge=1)
    scanned_delta: int = Field(default=0, ge=0, le=500)
    escalated_delta: int = Field(default=0, ge=0, le=500)
    skipped_delta: int = Field(default=0, ge=0, le=500)
    failed_delta: int = Field(default=0, ge=0, le=500)
    status: ProgressStatus = "running"
    error_summary: str | None = Field(default=None, max_length=500)


class PatrolScanJobOut(BaseModel):
    """任务出参：供 Agent 管理端展示进度与终态。"""

    model_config = {"from_attributes": True}

    id: int
    status: str
    target_types: list[str]
    cursor_type: str | None
    cursor_id: int | None
    scanned: int
    escalated: int
    skipped: int
    failed: int
    cancel_requested: bool
    created_by: int | None
    trace_id: str
    error_summary: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
