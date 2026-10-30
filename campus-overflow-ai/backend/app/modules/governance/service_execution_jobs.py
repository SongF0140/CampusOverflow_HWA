"""短租约领取与确定性结果反馈；不保存管理员JWT或任意模型栈。"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.governance import domain, repository, service_execution_actions
from app.modules.governance.schemas_executions import ExecutionClaim, ExecutionReport


def claim(db: Session) -> ExecutionClaim | None:
    if not settings.governance_executor_enabled:
        return None
    candidates = repository.claim_candidates(db)
    for execution_id in candidates:
        job = repository.get_governance_job(db, execution_id)
        approval = repository.get_governance_approval(db, job.request_id, for_update=True)
        job = repository.get_governance_job(db, execution_id, for_update=True)
        now = datetime.now(UTC).replace(tzinfo=None)
        if job.continuation or job.state not in {"queued", "claimed", "completed"}:
            db.rollback()
            continue
        if job.lease_expires_at and job.lease_expires_at > now:
            db.rollback()
            continue
        if job.lease_epoch >= 3:
            repository.save_execution_report(db, execution_id, "result_unknown")
            db.commit()
            continue
        if approval.status not in {"approved", "executed"} or (
            job.result is None and approval.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC)
        ):
            repository.block_governance_execution(db, execution_id, "invalidated")
            db.commit()
            continue
        lease = secrets.token_urlsafe(32)
        epoch = job.lease_epoch + 1
        repository.save_execution_lease(
            db,
            execution_id,
            hashlib.sha256(lease.encode()).hexdigest(),
            epoch,
            now + timedelta(seconds=240),
        )
        db.commit()
        return ExecutionClaim(
            execution_id=execution_id,
            request_id=approval.request_id,
            lease=lease,
            lease_epoch=epoch,
            args_hash=approval.args_hash,
            frozen_call=approval.frozen_call,
            trace_id=approval.trace_id,
            case_id=approval.case_id, approved_by=approval.approved_by,
        )
    return None


def report(db: Session, execution_id: str, lease: str | None, req: ExecutionReport) -> dict:
    approval, job = service_execution_actions._load(db, execution_id, lease, req.lease_epoch)
    receipt = service_execution_actions._receipt(approval, job)
    if req.outcome == "completed" and receipt is None:
        raise domain.CaseTargetNotReadyError("缺少后端执行回执，不能宣称已执行")
    outcome = "completed" if receipt else req.outcome
    if not job.continuation:
        repository.save_execution_report(db, execution_id, outcome)
        db.commit()
    return {"execution_id": execution_id, "outcome": outcome, "executed": receipt is not None}
