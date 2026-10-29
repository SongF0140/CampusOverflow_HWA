"""GL-01只形成批准与任务，实际处置由后续独立执行契约完成。"""

import hashlib
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.governance import (
    domain,
    repository,
    service_approvals,
    service_notify,
)
from app.modules.governance.schemas import GovernanceRequestCreate
from app.modules.governance.schemas_executions import (
    FrozenGovernanceCall,
    GovernanceApprovalOut,
    GovernanceApprovalRecord,
    HumanApprovalDecision,
)
from app.modules.identity import service as identity_service


def _admin(db: Session, user_id: int) -> None:
    user = identity_service.get_by_id(db, user_id)
    if user.role != "admin" or user.status != "active":
        raise domain.CaseActionForbiddenError("当前管理员身份不可用")


def _hash(call: FrozenGovernanceCall) -> str:
    encoded = json.dumps(
        call.model_dump(mode="json"), sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _public(item: GovernanceApprovalRecord) -> GovernanceApprovalOut:
    return GovernanceApprovalOut.model_validate(item.model_dump())


def _current(db: Session, call: FrozenGovernanceCall) -> None:
    current = service_approvals.get_target_state(
        db,
        call.target_type,
        call.target_id,
        include_version=True,
        for_update=True,
    )
    allowed = current.current_state in {"ready", "active"} or (
        current.current_state == "hidden" and call.action == "delete"
    )
    if not allowed or current.state_version != call.expected_version:
        raise domain.CaseTargetNotReadyError("目标状态或内容已变化，请重新申请")


def _same_request(item, call, source_kind, source_key_hash) -> GovernanceApprovalOut:
    if (
        item.frozen_call != call
        or item.args_hash != _hash(call)
        or item.source_kind != source_kind
        or item.source_key_hash != source_key_hash
    ):
        raise domain.CaseTargetNotReadyError("申请标识或来源不一致，请使用新的申请标识")
    return _public(item)


def create_request(
    db: Session,
    admin_id: int,
    req: GovernanceRequestCreate,
    trace_id: str,
    *,
    source_key_hash: str | None = None,
) -> GovernanceApprovalOut:
    if not settings.governance_executor_enabled:
        raise domain.GovernanceExecutorDisabledError()
    _admin(db, admin_id)
    call = FrozenGovernanceCall(**req.model_dump(), requester_id=admin_id)
    request_id, source = str(call.request_id), "platform" if source_key_hash else "admin"
    existing = repository.get_governance_approval(db, request_id)
    if existing:
        return _same_request(existing, call, source, source_key_hash)
    try:
        _current(db, call)
        run_id = f"approval-{request_id}"
        repository.create_run(
            db,
            "approval_request",
            trace_id,
            run_id,
            f"治理v2申请：{call.target_type}#{call.target_id} {call.action}",
            user_id=admin_id,
        )
        case = repository.create_agent_case(
            db,
            call.target_type,
            call.target_id,
            "medium" if call.action in {"hide", "warn"} else "high",
            call.reason,
            call.model_dump_json(),
            trace_id,
            run_id,
            f"actor=admin:{admin_id} request={request_id} contract=approval-v2 status=pending",
        )
        item = repository.create_governance_approval(
            db,
            request_id=request_id,
            case_id=case.id,
            requester_id=admin_id,
            source_kind=source,
            source_key_hash=source_key_hash,
            frozen_call=call.model_dump(mode="json"),
            args_hash=_hash(call),
            status="pending",
            expires_at=(datetime.now(UTC) + timedelta(days=7)).replace(tzinfo=None),
            trace_id=trace_id,
            agent_run_id=run_id,
        )
        service_notify.notify_case_created(db, case.id, call.target_type, call.target_id)
        repository.update_run(db, run_id, "succeeded", "v2申请已保存，等待人工批准", None)
        db.commit()
        return _public(item)
    except IntegrityError:
        db.rollback()
        existing = repository.get_governance_approval(db, request_id)
        if existing:
            return _same_request(existing, call, source, source_key_hash)
        raise domain.CaseTargetNotReadyError("申请标识已使用，请重新申请") from None
    except Exception:
        db.rollback()
        raise


def read_request(db: Session, admin_id: int, request_id: str) -> GovernanceApprovalOut:
    _admin(db, admin_id)
    item = repository.get_governance_approval(db, request_id)
    if item is None:
        raise domain.DecisionNotFoundError()
    return _public(item)


def decide_request(
    db: Session,
    admin_id: int,
    request_id: str,
    decision: HumanApprovalDecision,
    *,
    approve: bool,
) -> GovernanceApprovalOut:
    _admin(db, admin_id)
    item = repository.get_governance_approval(db, request_id, for_update=True)
    if item is None:
        raise domain.DecisionNotFoundError()
    if item.args_hash != decision.args_hash or item.args_hash != _hash(item.frozen_call):
        raise domain.CaseTargetNotReadyError("批准参数与冻结清单不一致")
    if item.status == "approved" and approve or item.status == "rejected" and not approve:
        return _public(item)
    if item.status != "pending":
        raise domain.CaseTargetNotReadyError("申请已不处于待审状态")
    if item.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC):
        repository.decide_governance_approval(db, request_id, "expired", admin_id, "申请已过期")
        db.commit()
        raise domain.CaseTargetNotReadyError("申请已过期，请重新申请")
    case = repository.get_case_by_id(db, item.case_id, for_update=True)
    if case is None or case.status != "pending" or case.agent_run_id != item.agent_run_id:
        raise domain.CaseTargetNotReadyError("关联工单或冻结快照已变化")
    try:
        stored = FrozenGovernanceCall.model_validate_json(case.snapshot or "{}")
    except ValueError:
        raise domain.CaseTargetNotReadyError("关联工单快照损坏") from None
    if stored != item.frozen_call:
        raise domain.CaseTargetNotReadyError("关联工单冻结快照已变化")
    if approve:
        _admin(db, item.requester_id)
        _ensure_source_active(item)
        _current(db, item.frozen_call)
    try:
        result = repository.decide_governance_approval(
            db,
            request_id,
            "approved" if approve else "rejected",
            admin_id,
            decision.note,
        )
        if not approve:
            repository.save_case_decision(
                db,
                case.id,
                status="rejected",
                manager_feedback=decision.note,
                agent_decision="skip",
                decision_source="human_approval_v2",
                decision_trace=(case.decision_trace or "")
                + f"\nactor=admin:{admin_id} request={request_id} status=rejected",
                resolution=None,
                resolved_by=admin_id,
                resolved_at=datetime.now(),
            )
        db.commit()
        return _public(result)
    except Exception:
        db.rollback()
        raise


def _ensure_source_active(item: GovernanceApprovalRecord) -> None:
    if item.source_kind != "platform":
        return
    mappings = domain.parse_external_admin_mappings(settings.external_agent_keys)
    active = mappings is not None and any(
        entry["enabled"]
        and entry["user_id"] == item.requester_id
        and entry["key_hash"] == item.source_key_hash
        for entry in mappings
    )
    if not active:
        raise domain.CaseActionForbiddenError("申请来源凭证已撤销，请重新申请")
