"""获批治理执行：所有业务写入、回执和必需审计在同一事务提交。"""

import hashlib
import secrets
from datetime import UTC, datetime
from time import perf_counter

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.domain_error import DomainError
from app.modules.governance import (
    domain,
    repository,
    service_executions,
    service_internal,
    service_notify,
)
from app.modules.governance.schemas import ModerationCaseOut
from app.modules.governance.schemas_executions import (
    ExecutionStatusOut,
    FrozenGovernanceCall,
    GovernanceApprovalRecord,
    GovernanceExecutionReceipt,
    GovernanceJobRecord,
)


def _load(
    db: Session,
    execution_id: str,
    lease: str | None,
    epoch: int,
) -> tuple[GovernanceApprovalRecord, GovernanceJobRecord]:
    job = repository.get_governance_job(db, execution_id)
    if job is None:
        raise domain.DecisionNotFoundError()
    # 所有新通道固定先锁申请再锁任务；领取器也必须采用此顺序。
    approval = repository.get_governance_approval(db, job.request_id, for_update=True)
    job = repository.get_governance_job(db, execution_id, for_update=True)
    if approval is None or job is None or approval.execution_id != execution_id:
        raise domain.CaseTargetNotReadyError("执行任务关联不一致")
    valid = (
        lease
        and job.lease_hash
        and job.lease_epoch == epoch
        and job.lease_expires_at
        and job.lease_expires_at.replace(tzinfo=UTC) > datetime.now(UTC)
        and secrets.compare_digest(hashlib.sha256(lease.encode()).hexdigest(), job.lease_hash)
    )
    if not valid:
        raise domain.CaseActionForbiddenError("执行租约无效、已过期或已被替换")
    return approval, job


def _receipt(
    approval: GovernanceApprovalRecord,
    job: GovernanceJobRecord,
) -> GovernanceExecutionReceipt | None:
    if job.result is None:
        return None
    receipt = GovernanceExecutionReceipt.model_validate(job.result)
    call = approval.frozen_call
    if (
        job.state != "completed"
        or approval.status != "executed"
        or receipt.execution_id != job.execution_id
        or receipt.request_id != approval.request_id
        or receipt.case_id != approval.case_id
        or receipt.args_hash != approval.args_hash
        or receipt.action != call.action
        or receipt.target_type != call.target_type
        or receipt.target_id != call.target_id
        or receipt.approved_by != approval.approved_by
    ):
        raise domain.CaseTargetNotReadyError("执行回执不一致，请人工核对")
    return receipt


def _authorized(
    db: Session,
    approval: GovernanceApprovalRecord,
    job: GovernanceJobRecord,
) -> ModerationCaseOut:
    if approval.status != "approved" or job.state != "claimed":
        raise domain.CaseTargetNotReadyError("任务尚未获批领取或已停止")
    if approval.approved_by is None or approval.approved_at is None:
        raise domain.CaseTargetNotReadyError("缺少真实管理员批准")
    if approval.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC):
        raise domain.CaseTargetNotReadyError("批准已过期，请重新申请")
    call = approval.frozen_call
    if (
        service_executions._hash(call) != approval.args_hash
        or call.requester_id != approval.requester_id
        or str(call.request_id) != approval.request_id
    ):
        raise domain.CaseTargetNotReadyError("冻结调用与批准记录不一致")
    for user_id in sorted({approval.requester_id, approval.approved_by}):
        service_executions._admin(db, user_id, for_update=True)
    service_executions._ensure_source_active(approval)
    case = repository.get_case_by_id(db, approval.case_id, for_update=True)
    if (
        case is None
        or case.status != "pending"
        or case.agent_run_id != approval.agent_run_id
        or case.target_type != call.target_type
        or case.target_id != call.target_id
        or case.reason != call.reason
    ):
        raise domain.CaseTargetNotReadyError("关联工单状态或目标已变化")
    try:
        stored = FrozenGovernanceCall.model_validate_json(case.snapshot or "{}")
    except ValueError:
        raise domain.CaseTargetNotReadyError("关联工单快照损坏") from None
    if stored != call:
        raise domain.CaseTargetNotReadyError("关联工单参数已变化")
    service_executions._current(db, call)
    return case


def _start_audit(db: Session, approval: GovernanceApprovalRecord, execution_id: str) -> str:
    run_id = f"execution-{execution_id}"
    repository.create_run(
        db,
        "governance_execute",
        approval.trace_id,
        run_id,
        f"获批治理：{approval.frozen_call.action}",
        user_id=approval.approved_by,
    )
    repository.create_run_event(
        db,
        run_id,
        approval.trace_id,
        1,
        "plan",
        1,
        [{"step_id": "s1", "tool_name": "executeApprovedGovernance"}],
        None,
        None,
        None,
    )
    repository.create_run_event(
        db,
        run_id,
        approval.trace_id,
        2,
        "step_started",
        1,
        None,
        "s1",
        "executeApprovedGovernance",
        None,
    )
    return run_id


def _finish_audit(
    db: Session,
    approval: GovernanceApprovalRecord,
    run_id: str,
    duration_ms: int,
) -> None:
    repository.create_tool_call(
        db,
        run_id,
        "executeApprovedGovernance",
        f"request={approval.request_id} hash={approval.args_hash}",
        "后端已执行并保存回执",
        "success",
        duration_ms,
        approval.trace_id,
    )
    repository.create_run_event(
        db,
        run_id,
        approval.trace_id,
        3,
        "step_succeeded",
        1,
        None,
        "s1",
        "executeApprovedGovernance",
        duration_ms,
    )
    repository.update_run(db, run_id, "succeeded", "获批治理已完成", None)


def _apply_and_receipt(
    db: Session,
    approval: GovernanceApprovalRecord,
    job: GovernanceJobRecord,
    case: ModerationCaseOut,
) -> GovernanceExecutionReceipt:
    call, admin_id = approval.frozen_call, approval.approved_by
    run_id = _start_audit(db, approval, job.execution_id)
    started = perf_counter()
    service_internal.apply_moderation_action(db, case, call.action, admin_id, call.duration_days)
    committed_at = datetime.now(UTC)
    repository.save_case_decision(
        db,
        case.id,
        status="executed",
        manager_feedback=approval.review_note or "人工已批准",
        agent_decision=call.action,
        decision_source="approved_tool_v2",
        decision_trace=(case.decision_trace or "")
        + f"\nactor=admin:{admin_id} execution={job.execution_id} status=executed",
        resolution=call.action,
        resolved_by=admin_id,
        resolved_at=committed_at.replace(tzinfo=None),
    )
    service_notify.notify_case_resolved(
        db, case.id, call.target_type, call.target_id, call.action, admin_id
    )
    receipt = GovernanceExecutionReceipt(
        execution_id=job.execution_id,
        request_id=approval.request_id,
        case_id=case.id,
        args_hash=approval.args_hash,
        target_type=call.target_type,
        target_id=call.target_id,
        action=call.action,
        approved_by=admin_id,
        committed_at=committed_at,
        trace_id=approval.trace_id,
        agent_run_id=run_id,
    )
    _finish_audit(db, approval, run_id, round((perf_counter() - started) * 1000))
    repository.finish_governance_execution(db, job.execution_id, receipt.model_dump(mode="json"))
    return receipt


def execute(
    db: Session,
    execution_id: str,
    lease: str | None,
    epoch: int,
) -> GovernanceExecutionReceipt:
    approval, job = _load(db, execution_id, lease, epoch)
    cached = _receipt(approval, job)
    if cached:
        return cached
    if not settings.governance_executor_enabled:
        raise domain.GovernanceExecutorDisabledError()
    try:
        case = _authorized(db, approval, job)
    except DomainError as error:
        status = "blocked" if error.http_status == 403 else "invalidated"
        repository.block_governance_execution(db, execution_id, status)
        db.commit()
        raise
    try:
        receipt = _apply_and_receipt(db, approval, job, case)
        db.commit()
        return receipt
    except Exception:
        db.rollback()
        raise


def read(db: Session, execution_id: str, lease: str | None, epoch: int) -> ExecutionStatusOut:
    approval, job = _load(db, execution_id, lease, epoch)
    receipt = _receipt(approval, job)
    return ExecutionStatusOut(
        execution_id=execution_id, state=job.state, executed=receipt is not None, receipt=receipt
    )
