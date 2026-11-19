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

    worker_token: str = Field(min_length=32, max_length=64)
    cursor_type: ScanTargetType | None = None
    cursor_id: int | None = Field(default=None, ge=1)
    scanned_delta: int = Field(default=0, ge=0, le=500)
    escalated_delta: int = Field(default=0, ge=0, le=500)
    skipped_delta: int = Field(default=0, ge=0, le=500)
    failed_delta: int = Field(default=0, ge=0, le=500)
    status: ProgressStatus = "running"
    error_summary: str | None = Field(default=None, max_length=500)


class PatrolScanClaimRequest(BaseModel):
    """worker 原子认领：同一个任务同时只允许一个 token 推进。"""

    model_config = {"extra": "forbid"}

    worker_id: str = Field(min_length=1, max_length=64)
    lease_seconds: int = Field(default=60, ge=10, le=300)


class PatrolScanHeartbeatRequest(BaseModel):
    """续租：只有当前 token 且租约未过期才能延长。"""

    model_config = {"extra": "forbid"}

    worker_token: str = Field(min_length=32, max_length=64)
    lease_seconds: int = Field(default=60, ge=10, le=300)


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


class PatrolScanClaimOut(BaseModel):
    """认领结果：token 只返回一次，后续进度与续租都必须携带。"""

    job: PatrolScanJobOut
    worker_token: str
    lease_expires_at: datetime


class PatrolScanLeaseOut(BaseModel):
    job: PatrolScanJobOut
    lease_expires_at: datetime
