"""审批预览、持久申请与冻结校验；真实处置复用现有治理用例。"""

import hashlib
import json
from datetime import UTC, datetime, timedelta

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.governance import domain, repository, service_notify
from app.modules.governance.schemas import (
    FrozenApprovalSnapshot,
    GovernanceRequestOut,
    GovernanceTargetStateOut,
    ModerationCaseOut,
)
from app.modules.identity import domain as identity_domain
from app.modules.identity import service as identity_service
from app.modules.qa import service as qa_service


def get_target_state(
    db: Session, target_type: str, target_id: int, *,
    include_version: bool = False, for_update: bool = False,
) -> GovernanceTargetStateOut:
    """仅查目标自身状态，不调用会惰性解禁的用户治理探针。"""
    if include_version:
        snapshot = (
            identity_service.get_governance_snapshot(db, target_id, for_update=for_update)
            if target_type == "user"
            else qa_service.moderation_get_snapshot(
                db, target_type, target_id, for_update=for_update,
            )
        )
        encoded = json.dumps(
            [target_type, target_id, snapshot], sort_keys=True, ensure_ascii=False, default=str,
        ).encode("utf-8")
        return GovernanceTargetStateOut(
            target_type=target_type, target_id=target_id, current_state=snapshot["state"],
            state_version=hashlib.sha256(encoded).hexdigest(),
        )
    if target_type == "user":
        try:
            state = identity_service.get_by_id(db, target_id).status
        except identity_domain.UserNotFoundError:
            state = "missing"
    else:
        state = qa_service.probe_moderation_target(db, target_type, target_id)
    return GovernanceTargetStateOut(
        target_type=target_type, target_id=target_id, current_state=state,
    )


def _ack(
    case: ModerationCaseOut, frozen: FrozenApprovalSnapshot, repeat: bool,
) -> GovernanceRequestOut:
    return GovernanceRequestOut(
        request_id=str(frozen.request_id), case_id=case.id, agent_run_id=case.agent_run_id,
        target_type=case.target_type, target_id=case.target_id, action=frozen.action,
        duration_days=frozen.duration_days, status=case.status, repeat=repeat,
    )


def _existing_request(db: Session, frozen: FrozenApprovalSnapshot) -> GovernanceRequestOut | None:
    run = repository.get_run_by_agent_run_id(db, f"approval-{frozen.request_id}")
    if run is None:
        return None
    case = repository.get_case_by_run_id(db, run.agent_run_id)
    try:
        stored = FrozenApprovalSnapshot.model_validate_json(case.snapshot if case else "{}")
    except ValidationError:
        raise domain.CaseTargetNotReadyError("申请标识已被使用，请使用新标识重新申请") from None
    if (run.user_id != frozen.requester_id or run.task_type != "approval_request"
            or stored != frozen or case.reason != frozen.reason):
        raise domain.CaseTargetNotReadyError("申请标识或参数不一致，请重新申请")
    return _ack(case, frozen, True)


def _ensure_current(db: Session, frozen: FrozenApprovalSnapshot) -> None:
    current = get_target_state(
        db, frozen.target_type, frozen.target_id, include_version=True, for_update=True,
    )
    allowed = current.current_state in {"ready", "active"} or (
        current.current_state == "hidden" and frozen.action == "delete"
    )
    if not allowed or current.state_version != frozen.expected_version:
        raise domain.CaseTargetNotReadyError("目标状态或内容已变化，请重新预览并申请")


def create_request(
    db: Session, admin_id: int, request_id: str, expected_version: str,
    target_type: str, target_id: int, action: str, reason: str,
    duration_days: int | None, trace_id: str,
) -> GovernanceRequestOut:
    frozen = FrozenApprovalSnapshot(
        contract="approval-v1", requester_id=admin_id, request_id=request_id,
        expected_version=expected_version, target_type=target_type, target_id=target_id,
        action=action, reason=reason, duration_days=duration_days,
    )
    existing = _existing_request(db, frozen)
    if existing is not None:
        return existing
    try:
        _ensure_current(db, frozen)
        run_id = f"approval-{frozen.request_id}"
        repository.create_run(
            db, "approval_request", trace_id, run_id,
            f"治理申请：{target_type}#{target_id} {action}", user_id=admin_id,
        )
        case = repository.create_agent_case(
            db, target_type, target_id, "medium" if action in {"hide", "warn"} else "high",
            frozen.reason, frozen.model_dump_json(), trace_id, run_id,
            f"[{datetime.now(UTC).isoformat()}] actor=admin:{admin_id} request={frozen.request_id} "
            f"action={action} status=pending",
        )
        service_notify.notify_case_created(db, case.id, target_type, target_id)
        repository.create_approval_wait(
            db, str(frozen.request_id), case.id, admin_id, trace_id,
            (datetime.now(UTC) + timedelta(days=7)).replace(tzinfo=None),
        )
        repository.update_run(db, run_id, "succeeded", f"工单 #{case.id} 已建，等待人工审批", None)
        db.commit()
        return _ack(case, frozen, False)
    except IntegrityError:
        db.rollback()
        existing = _existing_request(db, frozen)
        if existing is not None:
            return existing
        raise
    except Exception:
        db.rollback()
        raise


def validate_frozen_request(
    db: Session, case: ModerationCaseOut, decision: str, duration_days: int | None,
) -> None:
    """所有新格式工单的决策入口共用；拒绝损坏快照及动作/期限/版本替换。"""
    if repository.get_governance_approval(db, case_id=case.id):
        raise domain.CaseTargetNotReadyError("v2申请须通过专用批准入口，不能使用旧决策通道")
    if not (case.agent_run_id or "").startswith("approval-"):
        return
    if decision == domain.CASE_DECISION_SKIP:
        return
    try:
        frozen = FrozenApprovalSnapshot.model_validate_json(case.snapshot or "{}")
    except ValidationError:
        raise domain.CaseTargetNotReadyError("审批快照无效，请重新申请") from None
    expected_days = duration_days
    if expected_days is None and decision == "ban_temp":
        expected_days = 7
    if (f"approval-{frozen.request_id}" != case.agent_run_id
            or frozen.target_type != case.target_type or frozen.target_id != case.target_id
            or frozen.action != decision or frozen.duration_days != expected_days):
        raise domain.CaseTargetNotReadyError("动作或期限与审批申请不一致，请重新申请")
    _ensure_current(db, frozen)
