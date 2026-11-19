"""管理员全量扫描任务（P2）：只维护进度与计数，内容由 qa 只读分页提供。"""

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.governance import domain, repository
from app.modules.governance.schemas_scan import (
    PatrolScanClaimOut,
    PatrolScanClaimRequest,
    PatrolScanCreateRequest,
    PatrolScanHeartbeatRequest,
    PatrolScanJobOut,
    PatrolScanLeaseOut,
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


def _is_active_slot_conflict(exc: IntegrityError) -> bool:
    """只把活动槽位唯一冲突映射为 409，其他完整性错误继续上抛。"""
    message = str(exc.orig).lower()
    return "active_slot" in message or "uq_patrol_scan_jobs_active_slot" in message


def _ensure_lease(row, worker_token: str) -> None:
    """fencing token 校验：token 不符或租约过期都视为失去任务，禁止继续推进。"""
    if row.worker_token != worker_token:
        raise domain.PatrolScanLeaseLostError("扫描任务已被其他 worker 接管")
    if row.lease_expires_at is None or row.lease_expires_at <= _now():
        raise domain.PatrolScanLeaseLostError("扫描任务租约已过期，请重新认领")


def create_scan(
    db: Session, req: PatrolScanCreateRequest, trace_id: str
) -> PatrolScanJobOut:
    """创建任务；同一时刻只允许一个排队中或运行中的扫描。

    先查一次用于常见路径的友好提示；真正的互斥由 active_slot 唯一索引保证，
    并发请求即使同时通过预检查，也只有一个能提交成功。
    """
    if repository.get_active_patrol_scan_job(db) is not None:
        raise domain.PatrolScanConflictError("已有全量扫描任务进行中，请先等待或取消")
    targets = list(dict.fromkeys(req.target_types or ALL_TARGET_TYPES))
    try:
        row = repository.create_patrol_scan_job(db, targets, req.created_by, trace_id)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _is_active_slot_conflict(exc):
            raise domain.PatrolScanConflictError(
                "已有全量扫描任务进行中，请先等待或取消"
            ) from exc
        raise
    db.refresh(row)
    return _to_out(row)


def get_scan(db: Session, job_id: int) -> PatrolScanJobOut:
    row = repository.get_patrol_scan_job(db, job_id)
    if row is None:
        raise domain.PatrolScanNotFoundError("全量扫描任务不存在")
    return _to_out(row)


def claim_scan(
    db: Session, job_id: int, req: PatrolScanClaimRequest
) -> PatrolScanClaimOut:
    """原子认领：并发实例只有一个能拿到 token，其余返回 409 而不是重复扫描。"""
    row = repository.get_patrol_scan_job(db, job_id)
    if row is None:
        raise domain.PatrolScanNotFoundError("全量扫描任务不存在")
    if row.status in TERMINAL_STATUSES:
        raise domain.PatrolScanStateError("扫描任务已结束，不能认领")
    token = secrets.token_urlsafe(24)
    expires_at = _now() + timedelta(seconds=req.lease_seconds)
    if not repository.try_claim_patrol_scan_job(
        db, job_id, req.worker_id, token, expires_at
    ):
        db.rollback()
        raise domain.PatrolScanConflictError("扫描任务已被其他 worker 认领")
    db.commit()
    row = repository.get_patrol_scan_job(db, job_id)
    return PatrolScanClaimOut(
        job=_to_out(row), worker_token=token, lease_expires_at=expires_at
    )


def renew_scan(
    db: Session, job_id: int, req: PatrolScanHeartbeatRequest
) -> PatrolScanLeaseOut:
    """续租：租约过期或已被接管后旧 worker 无法延长，只能重新认领。"""
    expires_at = _now() + timedelta(seconds=req.lease_seconds)
    if not repository.renew_patrol_scan_lease(
        db, job_id, req.worker_token, expires_at
    ):
        db.rollback()
        row = repository.get_patrol_scan_job(db, job_id)
        if row is None:
            raise domain.PatrolScanNotFoundError("全量扫描任务不存在")
        if row.status in TERMINAL_STATUSES:
            raise domain.PatrolScanStateError("扫描任务已结束，不能续租")
        raise domain.PatrolScanLeaseLostError("扫描任务租约已过期或已被接管")
    db.commit()
    row = repository.get_patrol_scan_job(db, job_id)
    return PatrolScanLeaseOut(job=_to_out(row), lease_expires_at=expires_at)


def cancel_scan(db: Session, job_id: int) -> PatrolScanJobOut:
    """取消任务：终态任务保持原状，可重复调用；同时释放 worker 租约。"""
    row = repository.get_patrol_scan_job(db, job_id, for_update=True)
    if row is None:
        raise domain.PatrolScanNotFoundError("全量扫描任务不存在")
    changed = False
    if row.status not in TERMINAL_STATUSES:
        row.cancel_requested = True
        row.status = "cancelled"
        row.finished_at = _now()
        changed = True
    if row.active_slot is not None:
        row.active_slot = None
        changed = True
    if (
        row.worker_token is not None
        or row.worker_id is not None
        or row.lease_expires_at is not None
    ):
        row.worker_id = None
        row.worker_token = None
        row.lease_expires_at = None
        changed = True
    if changed:
        db.commit()
        db.refresh(row)
    return _to_out(row)


def update_progress(
    db: Session, job_id: int, req: PatrolScanProgressRequest
) -> PatrolScanJobOut:
    """按批回写增量进度；每次写入都校验 fencing token 与租约。"""
    row = repository.get_patrol_scan_job(db, job_id, for_update=True)
    if row is None:
        raise domain.PatrolScanNotFoundError("全量扫描任务不存在")
    if row.status in TERMINAL_STATUSES:
        return _to_out(row)
    _ensure_lease(row, req.worker_token)
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
        row.active_slot = None
        row.worker_id = None
        row.worker_token = None
        row.lease_expires_at = None
    db.commit()
    db.refresh(row)
    return _to_out(row)


def read_page(
    db: Session, job_id: int, limit: int, worker_token: str
) -> tuple[PatrolScanJobOut, list[PatrolContentItem], bool]:
    """按任务游标读取下一页；只有持有有效租约的 worker 才能推进游标。"""
    row = repository.get_patrol_scan_job(db, job_id)
    if row is None:
        raise domain.PatrolScanNotFoundError("全量扫描任务不存在")
    job = _to_out(row)
    if row.status in TERMINAL_STATUSES:
        return job, [], False
    _ensure_lease(row, worker_token)
    rows = qa_service.list_full_scan_page(
        db, row.target_types, row.cursor_type, row.cursor_id, limit + 1
    )
    return job, rows[:limit], len(rows) > limit
