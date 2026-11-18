"""管理员全量扫描任务（P2）：只维护进度与计数，内容由 qa 只读分页提供。"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.modules.governance import domain, repository
from app.modules.governance.schemas_scan import (
    PatrolScanCreateRequest,
    PatrolScanJobOut,
    PatrolScanProgressRequest,
)
from app.modules.qa import service as qa_service
from app.modules.qa.schemas import PatrolContentItem

TERMINAL_STATUSES = frozenset({"succeeded", "failed", "cancelled"})
ALL_TARGET_TYPES = ["question", "answer", "comment"]


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_out(row) -> PatrolScanJobOut:
    return PatrolScanJobOut.model_validate(row)


def create_scan(
    db: Session, req: PatrolScanCreateRequest, trace_id: str
) -> PatrolScanJobOut:
    """创建任务；同一时刻只允许一个排队中或运行中的扫描。"""
    if repository.get_active_patrol_scan_job(db) is not None:
        raise domain.PatrolScanConflictError("已有全量扫描任务进行中，请先等待或取消")
    targets = list(dict.fromkeys(req.target_types or ALL_TARGET_TYPES))
    row = repository.create_patrol_scan_job(db, targets, req.created_by, trace_id)
    db.commit()
    db.refresh(row)
    return _to_out(row)


def get_scan(db: Session, job_id: int) -> PatrolScanJobOut:
    row = repository.get_patrol_scan_job(db, job_id)
    if row is None:
        raise domain.PatrolScanNotFoundError("全量扫描任务不存在")
    return _to_out(row)


def cancel_scan(db: Session, job_id: int) -> PatrolScanJobOut:
    """取消任务：终态任务保持原状，可重复调用。"""
    row = repository.get_patrol_scan_job(db, job_id, for_update=True)
    if row is None:
        raise domain.PatrolScanNotFoundError("全量扫描任务不存在")
    if row.status not in TERMINAL_STATUSES:
        row.cancel_requested = True
        row.status = "cancelled"
        row.finished_at = _now()
        db.commit()
        db.refresh(row)
    return _to_out(row)


def update_progress(
    db: Session, job_id: int, req: PatrolScanProgressRequest
) -> PatrolScanJobOut:
    """按批回写增量进度；任务已取消或已结束时不覆盖终态。"""
    row = repository.get_patrol_scan_job(db, job_id, for_update=True)
    if row is None:
        raise domain.PatrolScanNotFoundError("全量扫描任务不存在")
    if row.status in TERMINAL_STATUSES:
        return _to_out(row)
    if (req.cursor_type is None) != (req.cursor_id is None):
        raise domain.PatrolScanStateError("游标必须同时提供类型和 id")
    if row.status == "queued":
        row.status = "running"
        row.started_at = _now()
    row.scanned += req.scanned_delta
    row.escalated += req.escalated_delta
    row.skipped += req.skipped_delta
    row.failed += req.failed_delta
    if req.cursor_type is not None:
        row.cursor_type = req.cursor_type
        row.cursor_id = req.cursor_id
    if req.status in ("succeeded", "failed"):
        row.status = req.status
        row.finished_at = _now()
        row.error_summary = req.error_summary
    db.commit()
    db.refresh(row)
    return _to_out(row)


def read_page(
    db: Session, job_id: int, limit: int
) -> tuple[PatrolScanJobOut, list[PatrolContentItem], bool]:
    """按任务游标读取下一页；终态任务不再返回内容。"""
    row = repository.get_patrol_scan_job(db, job_id)
    if row is None:
        raise domain.PatrolScanNotFoundError("全量扫描任务不存在")
    job = _to_out(row)
    if row.status in TERMINAL_STATUSES:
        return job, [], False
    rows = qa_service.list_full_scan_page(
        db, row.target_types, row.cursor_type, row.cursor_id, limit + 1
    )
    return job, rows[:limit], len(rows) > limit
