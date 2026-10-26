# governance 对外管理业务层（T-15-A）：审批中心与申诉的用例编排。
# 分层基线 D-2/D-5：ORM 留在 repository；处置执行复用 service_internal 双环决策
# （不复制状态机/探针/真实处置逻辑）；作者归属经 qa 公开 service 查询；
# 解禁经 identity 公开 service（其事务边界为 commit，本层把 flush 的申诉
# 结果并入同一提交，保证回退与留痕原子生效）。
# 事务约定 D-8：写用例末尾显式 db.commit()，repository 只 flush 不提交。
from sqlalchemy.orm import Session

from app.core.logging import action_logger
from app.modules.governance import domain, repository, service_notify
from app.modules.governance.schemas import (
    AppealOut,
    ModerationCaseOut,
    RunTraceDetail,
)
from app.modules.governance.service_internal import update_case_agent_decision
from app.modules.identity import service as identity_service
from app.modules.qa import service as qa_service

# 申诉定位候选上限：最近已执行工单回看窗口（超出窗口的历史处置不再受理申诉）
APPEAL_CASE_LOOKUP_LIMIT = 50

# 工单状态合法值（列表筛选用）
CASE_STATUS_VALUES = (
    domain.CASE_STATUS_PENDING,
    domain.CASE_STATUS_AGENT_PROPOSED,
    domain.CASE_STATUS_MANAGER_DIRECTED,
    domain.CASE_STATUS_EXECUTED,
    domain.CASE_STATUS_REJECTED,
)


def list_moderation_cases(
    db: Session, page: int, page_size: int, status: str | None, source: str | None,
) -> tuple[list[ModerationCaseOut], int]:
    """工单队列（管理员）：状态/来源筛选 + 分页。"""
    if status is not None and status not in CASE_STATUS_VALUES:
        raise domain.CaseDecisionError(f"非法工单状态筛选 {status}")
    if source is not None and source not in ("agent", "admin"):
        raise domain.CaseDecisionError(f"非法来源筛选 {source}")
    return repository.list_moderation_cases(db, page, page_size, status, source)


def resolve_moderation_case(
    db: Session, admin_id: int, case_id: int, decision: str, manager_feedback: str,
    duration_days: int | None = None,
) -> ModerationCaseOut:
    """管理员处置工单：复用双环决策与真实处置执行。

    pending + 执行类决策按状态机分两步推进（先开 manager_directed 通道，
    再人工确认执行）——两步各自完整留痕且失败可恢复（中间态可再次调用收尾）；
    skip 一次直达 rejected。agent_proposed 工单的管理员确认同样经此入口。
    处置结果通知与决策同事务（T-15-C）：通知失败整体回滚。
    """
    case = repository.get_case_by_id(db, case_id)
    if case is None:
        raise domain.DecisionNotFoundError()
    trace_id = f"admin-{admin_id}"
    if case.status == domain.CASE_STATUS_PENDING and decision != domain.CASE_DECISION_SKIP:
        # 第一步：开启管理员直办通道（真实处置在此步不执行）
        update_case_agent_decision(
            db, case_id, manager_feedback, decision,
            caller_is_admin=True, principal_id=admin_id, trace_id=trace_id,
            decision_source=domain.CASE_STATUS_MANAGER_DIRECTED,
            duration_days=duration_days,
        )
    # 收尾：manager_directed → executed（真实处置）或 skip → rejected
    result = update_case_agent_decision(
        db, case_id, manager_feedback, decision,
        caller_is_admin=True, principal_id=admin_id, trace_id=trace_id,
        duration_days=duration_days,
    )
    service_notify.notify_case_resolved(
        db, case_id, result.target_type, result.target_id, decision, admin_id,
    )
    db.commit()
    return result


def _find_appealable_case(db: Session, user_id: int):
    """定位申诉人最近一条已执行且归属本人的工单。

    封禁类：target=user 且 target_id=本人；内容类：目标作者=本人
    （含已隐藏/已软删内容——被处置者恰需据此申诉）。
    """
    for case in repository.list_executed_cases_by_recency(db, APPEAL_CASE_LOOKUP_LIMIT):
        if case.target_type == domain.CASE_TARGET_USER:
            if case.target_id == user_id:
                return case
            continue
        if case.target_type in domain.CASE_CONTENT_TARGETS:
            if qa_service.get_content_author(db, case.target_type, case.target_id) == user_id:
                return case
    return None


def submit_appeal(db: Session, user_id: int, reason: str) -> AppealOut:
    """学生提交申诉：自动定位最近被执行的处置工单，重复申诉拒绝。

    申诉受理通知与申诉落库同事务（T-15-C）。
    """
    domain.ensure_appeal_reason(reason)
    case = _find_appealable_case(db, user_id)
    if case is None:
        raise domain.NoAppealableCaseError()
    if repository.has_pending_appeal(db, case.id, user_id):
        raise domain.AppealDuplicateError()
    appeal = repository.create_appeal(db, case.id, user_id, reason.strip())
    service_notify.notify_appeal_submitted(db, appeal.id, case.id, user_id)
    db.commit()
    action_logger.info(
        "appeal_submitted appeal_id=%s case_id=%s user_id=%s",
        appeal.id, case.id, user_id,
    )
    return appeal


def list_appeals(
    db: Session, page: int, page_size: int, status: str | None,
) -> tuple[list[AppealOut], int]:
    """申诉队列（管理员）：状态筛选 + 分页。"""
    if status is not None and status not in domain.APPEAL_STATUSES:
        raise domain.AppealInvalidError()
    return repository.list_appeals(db, page, page_size, status)


def resolve_appeal(
    db: Session, admin_id: int, appeal_id: int, resolution: str, resolution_note: str,
) -> AppealOut:
    """管理员复核申诉：rejected 维持处置；accepted 按工单处置回退。

    回退映射：ban → 解禁（identity 审计留痕）；hide → 恢复可见；
    delete → 恢复软删。回退与申诉结果同事务提交；工单保持 executed
    终态不改写历史，申诉留 resolution 记录。
    """
    domain.ensure_appeal_resolution(resolution)
    appeal = repository.get_appeal_by_id(db, appeal_id)
    if appeal is None:
        raise domain.AppealNotFoundError()
    if appeal.status != "pending":
        raise domain.AppealAlreadyResolvedError()
    case = repository.get_case_by_id(db, appeal.case_id)
    if case is None:
        raise domain.AppealNotFoundError()

    if resolution == "accepted":
        # 复核结果通知在回退动作之后 flush，由解禁的内部 commit 一并提交（T-15-C）
        # ban 与 ban_temp 同走解禁回退（set_active 统一清空原因与期限）
        if case.resolution in (domain.CASE_DECISION_BAN, domain.CASE_DECISION_BAN_TEMP):
            # 解禁内部 commit：把此前 flush 的申诉结果一并提交（原子生效）
            repository.save_appeal_resolution(
                db, appeal_id, status="accepted",
                resolution_note=resolution_note, resolved_by=admin_id,
            )
            service_notify.notify_appeal_resolved(
                db, appeal_id, appeal.user_id, accepted=True, actor_id=admin_id,
            )
            identity_service.unban_user(db, case.target_id, admin_id)
        else:
            if case.target_type in domain.CASE_CONTENT_TARGETS:
                if case.resolution == domain.CASE_DECISION_HIDE:
                    qa_service.moderation_restore_visible(db, case.target_type, case.target_id)
                elif case.resolution == domain.CASE_DECISION_DELETE:
                    qa_service.moderation_restore_deleted(db, case.target_type, case.target_id)
            repository.save_appeal_resolution(
                db, appeal_id, status="accepted",
                resolution_note=resolution_note, resolved_by=admin_id,
            )
            service_notify.notify_appeal_resolved(
                db, appeal_id, appeal.user_id, accepted=True, actor_id=admin_id,
            )
            db.commit()
    else:
        repository.save_appeal_resolution(
            db, appeal_id, status="rejected",
            resolution_note=resolution_note, resolved_by=admin_id,
        )
        service_notify.notify_appeal_resolved(
            db, appeal_id, appeal.user_id, accepted=False, actor_id=admin_id,
        )
        db.commit()
    action_logger.info(
        "appeal_resolved appeal_id=%s case_id=%s resolution=%s admin_id=%s",
        appeal_id, appeal.case_id, resolution, admin_id,
    )
    resolved = repository.get_appeal_by_id(db, appeal_id)
    if resolved is None:
        raise domain.AppealNotFoundError()
    return AppealOut.model_validate(resolved)


# ---------- 观测与审计（T-16-A，US-18/C-08） ----------

RUN_STATUS_VALUES = ("running", "succeeded", "failed")


def list_agent_runs(
    db: Session, page: int, page_size: int,
    status: str | None, task_type: str | None, user_id: int | None,
) -> tuple[list, int]:
    """运行列表（管理员）：状态/任务类型/用户筛选 + 分页（失败运行可定位）。"""
    if status is not None and status not in RUN_STATUS_VALUES:
        raise domain.CaseDecisionError(f"非法运行状态筛选 {status}")
    return repository.list_runs_filtered(db, page, page_size, status, task_type, user_id)


def get_run_trace(db: Session, agent_run_id: str) -> RunTraceDetail:
    """单运行完整调用链：运行 + 事件 + 工具调用 + 同 trace 关联工单（US-18）。"""
    run = repository.get_run_by_agent_run_id(db, agent_run_id)
    if run is None:
        raise domain.RunNotFoundError()
    return RunTraceDetail(
        run=run,
        events=repository.list_run_events(db, agent_run_id),
        tool_calls=repository.list_tool_calls_by_run(db, agent_run_id),
        related_cases=repository.list_cases_by_trace(db, run.trace_id),
    )
