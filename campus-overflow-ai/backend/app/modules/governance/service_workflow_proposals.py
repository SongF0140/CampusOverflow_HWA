"""系统冻结申请沿用v2人类批准及原子处置，不接收自报身份和目标。"""

from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.governance import domain, repository, service_executions, service_notify
from app.modules.governance.schemas_executions import FrozenGovernanceCall
from app.modules.governance.schemas_workflow import WorkflowProposal
from app.modules.governance.service_workflow_scope import action_target, active_task


def create_proposal(db: Session, task_id: str, req: WorkflowProposal):
    if not settings.governance_executor_enabled:
        raise domain.GovernanceExecutorDisabledError()
    root = active_task(db, task_id)
    target_type, target_id = action_target(db, root, req.action)
    call = FrozenGovernanceCall(
        request_id=req.request_id,
        requester_id=None,
        workflow_task_id=task_id,
        workflow_round=req.round,
        target_type=target_type,
        target_id=target_id,
        expected_version=req.expected_version,
        action=req.action,
        reason=req.reason,
        duration_days=req.duration_days,
    )
    request_id = str(req.request_id)
    existing = repository.get_governance_approval(db, request_id)
    if existing:
        return service_executions._same_request(existing, call, "system_patrol", None)
    try:
        service_executions._current(db, call)
        run_id = f"approval-{request_id}"
        repository.create_run(
            db,
            "approval_request",
            root.trace_id,
            run_id,
            f"系统治理申请 {task_id} round={req.round}",
        )
        case = repository.create_agent_case(
            db,
            target_type,
            target_id,
            "high",
            req.reason,
            call.model_dump_json(),
            root.trace_id,
            run_id,
            f"source=system_patrol root={task_id} round={req.round}",
        )
        result = repository.create_governance_approval(
            db,
            request_id=request_id,
            case_id=case.id,
            requester_id=None,
            source_kind="system_patrol",
            frozen_call=call.model_dump(mode="json"),
            args_hash=service_executions._hash(call),
            status="pending",
            expires_at=(root.created_at + timedelta(days=7)),
            trace_id=root.trace_id,
            agent_run_id=run_id,
        )
        service_notify.notify_case_created(db, case.id, target_type, target_id)
        repository.update_run(db, run_id, "succeeded", "系统申请待人工批准", None)
        db.commit()
        return service_executions._public(result)
    except IntegrityError:
        db.rollback()
        existing = repository.get_governance_approval(db, request_id)
        if existing:
            return service_executions._same_request(existing, call, "system_patrol", None)
        raise
    except Exception:
        db.rollback()
        raise


def read_proposal(db: Session, task_id: str, request_id: str):
    item = repository.get_governance_approval(db, request_id, for_update=True)
    if (
        item is None
        or item.source_kind != "system_patrol"
        or item.frozen_call.workflow_task_id != task_id
    ):
        raise domain.DecisionNotFoundError()
    if item.status in {"pending", "approved"} and item.expires_at.replace(
        tzinfo=UTC
    ) <= datetime.now(UTC):
        item = repository.close_governance_approval(db, request_id, "expired", None, "等待过期")
        db.commit()
    return service_executions._public(item)


def read_receipt(db: Session, task_id: str, request_id: str):
    item = read_proposal(db, task_id, request_id)
    job = repository.get_governance_job(db, item.execution_id) if item.execution_id else None
    return job.result if job else None
