# governance 数据访问：agent_runs / tool_call_logs / agent_memory / moderation_cases
# 分层基线 D-2：本文件是模块内唯一允许 import models 的地方；出参一律 schemas。
# 事务约定 D-8：本层只 flush 不 commit，事务边界（commit）在 service 用例层。
from datetime import datetime
from uuid import uuid4

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.modules.governance import domain
from app.modules.governance.models import (
    AgentExperience,
    AgentMemory,
    AgentRun,
    AgentRunEvent,
    AnonymousLearningEvent,
    Appeal,
    ApprovalWait,
    ClassChangeRequest,
    CourseTagSource,
    GovernanceApprovalRequest,
    GovernanceExecutionJob,
    ModerationCase,
    ToolCallLog,
)
from app.modules.governance.schemas import (
    AgentRunOut,
    AppealOut,
    ApprovalWaitOut,
    MemoryItemOut,
    ModerationCaseOut,
    RunEventOut,
    ToolCallOut,
)
from app.modules.governance.schemas_executions import GovernanceApprovalRecord, GovernanceJobRecord
from app.modules.governance.schemas_experiences import ExperienceOut
from app.modules.governance.schemas_learning import LearningEventOut, TrustedTagSourceOut
from app.modules.governance.schemas_roles import ClassChangeOut


def get_governance_approval(
    db: Session, request_id: str | None = None, *, case_id: int | None = None,
    for_update: bool = False,
) -> GovernanceApprovalRecord | None:
    query = db.query(GovernanceApprovalRequest)
    if request_id:
        query = query.filter(GovernanceApprovalRequest.request_id == request_id)
    else:
        query = query.filter(GovernanceApprovalRequest.case_id == case_id)
    if for_update:
        query = query.with_for_update().populate_existing()
    row = query.first()
    if row is None:
        return None
    jobs = db.query(GovernanceExecutionJob).filter_by(request_id=row.request_id)
    if for_update:
        jobs = jobs.with_for_update().populate_existing()
    job = jobs.first()
    result = GovernanceApprovalRecord.model_validate(row)
    return result.model_copy(update={"execution_id": job.execution_id if job else None,
                                     "execution_state": job.state if job else None,
                                     "continuation": job.continuation if job else None,
                                     "executed": row.status == "executed"})


def create_governance_approval(db: Session, **values) -> GovernanceApprovalRecord:
    db.add(GovernanceApprovalRequest(**values))
    db.flush()
    return get_governance_approval(db, values["request_id"])


def decide_governance_approval(
    db: Session, request_id: str, status: str, reviewer_id: int, note: str,
) -> GovernanceApprovalRecord:
    row = db.get(GovernanceApprovalRequest, request_id)
    row.status, row.review_note = status, note
    if status == "approved":
        row.approved_by, row.approved_at = reviewer_id, datetime.now()
        db.add(GovernanceExecutionJob(execution_id=str(uuid4()), request_id=request_id))
    elif status == "expired":
        case = db.get(ModerationCase, row.case_id, with_for_update=True)
        if case.status == "pending":
            case.status, case.resolved_at = "rejected", datetime.now()
            case.decision_trace = (case.decision_trace or "") + f"\nrequest={request_id} expired"
    db.flush()
    return get_governance_approval(db, request_id)


def get_governance_job(
    db: Session, execution_id: str, *, for_update: bool = False,
) -> GovernanceJobRecord | None:
    query = db.query(GovernanceExecutionJob).filter_by(execution_id=execution_id)
    if for_update:
        query = query.with_for_update().populate_existing()
    row = query.first()
    return GovernanceJobRecord.model_validate(row) if row else None


def finish_governance_execution(db: Session, execution_id: str, receipt: dict) -> None:
    job = db.get(GovernanceExecutionJob, execution_id)
    approval = db.get(GovernanceApprovalRequest, job.request_id)
    job.state, job.result = "completed", receipt
    approval.status = "executed"
    db.flush()


def claim_candidates(db: Session) -> list[str]:
    rows = db.query(GovernanceExecutionJob.execution_id).filter(
        GovernanceExecutionJob.state.in_(["queued", "claimed", "completed"]),
        GovernanceExecutionJob.continuation.is_(None),
    ).order_by(
        GovernanceExecutionJob.created_at, GovernanceExecutionJob.execution_id,
    ).limit(100).all()
    return [row.execution_id for row in rows]


def save_execution_lease(db: Session, execution_id: str, digest: str, epoch: int, until: datetime):
    job = db.get(GovernanceExecutionJob, execution_id)
    job.lease_hash, job.lease_epoch, job.lease_expires_at = digest, epoch, until
    if job.result is None:
        job.state = "claimed"
    db.flush()


def save_execution_report(db: Session, execution_id: str, outcome: str) -> None:
    job = db.get(GovernanceExecutionJob, execution_id)
    job.continuation = {"version": 1,
                        "stage": "done" if outcome == "completed" else "manual_review",
                        "outcome": outcome, "tool_calls": 1, "proposal_limit": 3,
                        "lease_attempts": job.lease_epoch}
    if job.result is None:
        job.state = outcome
    db.flush()


def block_governance_execution(db: Session, execution_id: str, status: str) -> None:
    job = db.get(GovernanceExecutionJob, execution_id)
    approval = db.get(GovernanceApprovalRequest, job.request_id)
    job.state = "blocked"
    if approval.status == "approved":
        approval.status = status
        case = db.get(
            ModerationCase, approval.case_id, with_for_update=True, populate_existing=True,
        )
        if case.status == "pending":
            case.status, case.resolved_at = "rejected", datetime.now()
            case.decision_trace = (
                (case.decision_trace or "") + f"\nexecution={execution_id} {status}"
            )
    db.flush()


def get_class_change(db: Session, request_id: str) -> ClassChangeOut | None:
    row = db.get(ClassChangeRequest, request_id, with_for_update=True, populate_existing=True)
    return ClassChangeOut.model_validate(row) if row else None


def create_class_change(db: Session, **values) -> ClassChangeOut:
    row = ClassChangeRequest(**values)
    db.add(row)
    db.flush()
    return ClassChangeOut.model_validate(row)


def finish_class_change(db: Session, request_id: str, status: str) -> ClassChangeOut:
    row = db.get(ClassChangeRequest, request_id)
    row.status = status
    db.flush()
    return ClassChangeOut.model_validate(row)


def list_trusted_tag_sources(
    db: Session, course_id: int | None = None,
) -> list[TrustedTagSourceOut]:
    query = db.query(CourseTagSource)
    if course_id is not None:
        query = query.filter(CourseTagSource.course_id == course_id)
    rows = query.all()
    return [TrustedTagSourceOut.model_validate(row) for row in rows]


def save_trusted_tag_source(
    db: Session, course_id: int, tag_id: int, source: str, active: bool,
    source_ref: str | None, actor_id: int,
) -> TrustedTagSourceOut:
    row = db.query(CourseTagSource).filter_by(course_id=course_id, tag_id=tag_id).first()
    if row is None:
        row = CourseTagSource(course_id=course_id, tag_id=tag_id, maintained_by=actor_id)
        db.add(row)
    row.source, row.active, row.source_ref, row.maintained_by = source, active, source_ref, actor_id
    db.flush()
    return TrustedTagSourceOut.model_validate(row)


def get_learning_event(db: Session, event_id: str) -> LearningEventOut | None:
    row = db.query(AnonymousLearningEvent).filter_by(event_id=event_id).first()
    return LearningEventOut.model_validate(row) if row else None


def create_learning_event(
    db: Session, event_id: str, course_id: int, tag_ids: list[int],
    node_ids: list[int], question_id: int | None,
) -> LearningEventOut:
    row = AnonymousLearningEvent(event_id=event_id, course_id=course_id, tag_ids=tag_ids,
                                 knowledge_node_ids=node_ids, question_id=question_id)
    db.add(row)
    db.flush()
    return LearningEventOut.model_validate(row)


def list_learning_events(db: Session, course_id: int, since: datetime) -> list[LearningEventOut]:
    rows = db.query(AnonymousLearningEvent).filter(
        AnonymousLearningEvent.course_id == course_id, AnonymousLearningEvent.created_at >= since,
    ).all()
    return [LearningEventOut.model_validate(row) for row in rows]

# ---------- Agent 运行（agent_runs） ----------


def create_approval_wait(
    db: Session, request_id: str, case_id: int, user_id: int, trace_id: str,
    expires_at: datetime | None,
) -> None:
    db.add(ApprovalWait(request_id=request_id, case_id=case_id, user_id=user_id,
                        trace_id=trace_id, expires_at=expires_at, state="waiting"))
    db.flush()


def get_approval_wait(db: Session, request_id: str) -> ApprovalWaitOut | None:
    row = db.get(ApprovalWait, request_id, with_for_update=True, populate_existing=True)
    return ApprovalWaitOut.model_validate(row) if row else None


def finish_approval_wait(db: Session, request_id: str, state: str, result: dict) -> None:
    row = db.get(ApprovalWait, request_id)
    row.state, row.result = state, result
    db.flush()


def create_run(
    db: Session, task_type: str, trace_id: str, agent_run_id: str, input_summary: str,
    user_id: int | None = None,
) -> AgentRunOut:
    """新建运行记录，初始状态 running；agent_run_id 冲突由唯一索引兜底。"""
    run = AgentRun(
        user_id=user_id,
        task_type=task_type,
        trace_id=trace_id,
        agent_run_id=agent_run_id,
        input_summary=input_summary,
        status=domain.RUN_STATUS_RUNNING,
    )
    db.add(run)
    db.flush()
    return AgentRunOut.model_validate(run)


def get_run_by_agent_run_id(
    db: Session, agent_run_id: str, *, for_update: bool = False,
) -> AgentRunOut | None:
    """按运行标识查询（内部接口以 agent_run_id 字符串为定位键）。"""
    query = db.query(AgentRun).filter(AgentRun.agent_run_id == agent_run_id)
    if for_update:
        query = query.with_for_update()
    run = query.first()
    return AgentRunOut.model_validate(run) if run else None


def update_run(
    db: Session, agent_run_id: str, status: str,
    output_summary: str | None, error_summary: str | None,
) -> AgentRunOut:
    """迁移运行状态并补输出/失败摘要（状态机校验在 service/domain）。"""
    run = db.query(AgentRun).filter(AgentRun.agent_run_id == agent_run_id).one()
    run.status = status
    if output_summary is not None:
        run.output_summary = output_summary
    if error_summary is not None:
        run.error_summary = error_summary
    db.flush()
    return AgentRunOut.model_validate(run)


# ---------- 工具调用日志（tool_call_logs） ----------


def list_run_events(db: Session, agent_run_id: str) -> list[RunEventOut]:
    rows = db.query(AgentRunEvent).filter(
        AgentRunEvent.agent_run_id == agent_run_id,
    ).order_by(AgentRunEvent.sequence_no).all()
    return [RunEventOut.model_validate(row) for row in rows]


def list_runs_filtered(
    db: Session, page: int, page_size: int,
    status: str | None, task_type: str | None, user_id: int | None,
) -> tuple[list[AgentRunOut], int]:
    """管理端运行列表（T-16-A）：状态/任务类型/用户筛选 + 分页，最新在前。"""
    query = db.query(AgentRun)
    if status is not None:
        query = query.filter(AgentRun.status == status)
    if task_type is not None:
        query = query.filter(AgentRun.task_type == task_type)
    if user_id is not None:
        query = query.filter(AgentRun.user_id == user_id)
    total = query.count()
    rows = (
        query.order_by(AgentRun.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [AgentRunOut.model_validate(row) for row in rows], total


def list_tool_calls_by_run(db: Session, agent_run_id: str) -> list[ToolCallOut]:
    """某运行的工具调用日志（时间正序）。"""
    rows = (
        db.query(ToolCallLog)
        .filter(ToolCallLog.agent_run_id == agent_run_id)
        .order_by(ToolCallLog.id.asc())
        .all()
    )
    return [ToolCallOut.model_validate(row) for row in rows]


def list_cases_by_trace(db: Session, trace_id: str) -> list[ModerationCaseOut]:
    """同一 trace 关联的治理工单（观测调用链聚合：运行 → 工单溯源）。"""
    rows = (
        db.query(ModerationCase)
        .filter(ModerationCase.trace_id == trace_id)
        .order_by(ModerationCase.id.asc())
        .all()
    )
    return [ModerationCaseOut.model_validate(row) for row in rows]


def create_run_event(
    db: Session, agent_run_id: str, trace_id: str, sequence_no: int,
    event_type: str, plan_revision: int, steps: list[dict[str, str]] | None,
    step_id: str | None, tool_name: str | None, duration_ms: int | None,
) -> RunEventOut:
    row = AgentRunEvent(
        agent_run_id=agent_run_id, trace_id=trace_id, sequence_no=sequence_no,
        event_type=event_type, plan_revision=plan_revision, steps=steps,
        step_id=step_id, tool_name=tool_name, duration_ms=duration_ms,
    )
    db.add(row)
    db.flush()
    return RunEventOut.model_validate(row)


def create_tool_call(
    db: Session, agent_run_id: str, tool_name: str, args_summary: str | None,
    result_summary: str | None, status: str, duration_ms: int | None, trace_id: str,
) -> ToolCallOut:
    """落一条工具调用摘要日志（只存摘要，字段即摘要红线见模型注释）。"""
    log = ToolCallLog(
        agent_run_id=agent_run_id,
        tool_name=tool_name,
        args_summary=args_summary,
        result_summary=result_summary,
        status=status,
        duration_ms=duration_ms,
        trace_id=trace_id,
    )
    db.add(log)
    db.flush()
    return ToolCallOut.model_validate(log)


# ---------- 持久化记忆（agent_memory） ----------


def list_memories(
    db: Session, user_id: int, course_id: int | None, memory_types: list[str] | None
) -> list[MemoryItemOut]:
    """读取用户生效记忆（is_enabled=true），按类型/课程可选过滤，最近优先。"""
    query = db.query(AgentMemory).filter(
        AgentMemory.user_id == user_id, AgentMemory.is_enabled.is_(True)
    )
    if course_id is not None:
        query = query.filter(AgentMemory.course_id == course_id)
    if memory_types:
        query = query.filter(AgentMemory.memory_type.in_(memory_types))
    rows = (
        query.order_by(desc(AgentMemory.created_at), desc(AgentMemory.id))
        .limit(domain.MEMORY_LIST_LIMIT)
        .all()
    )
    return [MemoryItemOut.model_validate(row) for row in rows]


def create_memory(
    db: Session, user_id: int, memory_type: str, content: str,
    course_id: int | None, source_run_id: str | None,
) -> MemoryItemOut:
    """写入一条记忆（敏感信息过滤在 service 层，本层只落库）。"""
    item = AgentMemory(
        user_id=user_id,
        memory_type=memory_type,
        content=content,
        course_id=course_id,
        source_run_id=source_run_id,
        is_enabled=True,
    )
    db.add(item)
    db.flush()
    return MemoryItemOut.model_validate(item)


# ---------- 审批工单（moderation_cases，C-06：只建工单不执行） ----------


def create_agent_case(
    db: Session, target_type: str, target_id: int, risk_level: str, reason: str,
    snapshot: str, trace_id: str | None, agent_run_id: str | None,
    decision_trace: str,
) -> ModerationCaseOut:
    """Agent 来源工单落表：source=agent、status=pending，处置字段全部留空；
    decision_trace 写入建单首行（由 service 组装）。
    """
    case = ModerationCase(
        target_type=target_type,
        target_id=target_id,
        risk_level=risk_level,
        source=domain.CASE_SOURCE_AGENT,
        reason=reason,
        snapshot=snapshot,
        status=domain.CASE_STATUS_PENDING,
        trace_id=trace_id,
        agent_run_id=agent_run_id,
        decision_trace=decision_trace,
    )
    db.add(case)
    db.flush()
    return ModerationCaseOut.model_validate(case)


def get_case_by_id(
    db: Session, case_id: int, *, for_update: bool = False,
) -> ModerationCaseOut | None:
    """按 ID 查询工单。"""
    query = db.query(ModerationCase).filter(ModerationCase.id == case_id)
    if for_update:
        query = query.with_for_update().populate_existing()
    case = query.first()
    return ModerationCaseOut.model_validate(case) if case else None


def get_case_by_run_id(db: Session, run_id: str) -> ModerationCaseOut | None:
    case = db.query(ModerationCase).filter(ModerationCase.agent_run_id == run_id).first()
    return ModerationCaseOut.model_validate(case) if case else None


def save_case_decision(
    db: Session, case_id: int, *,
    status: str,
    manager_feedback: str,
    agent_decision: str,
    decision_source: str | None,
    decision_trace: str,
    resolution: str | None,
    resolved_by: int | None,
    resolved_at: datetime | None,
) -> ModerationCaseOut:
    """按状态机校验后的结果落库（状态机与权限校验在 service/domain 层完成）。

    决策双环字段（manager_feedback/agent_decision/decision_source）为"最新值"
    覆盖语义；完整历史由追加式 decision_trace 承担。
    """
    case = db.query(ModerationCase).filter(ModerationCase.id == case_id).one()
    case.status = status
    case.manager_feedback = manager_feedback
    case.agent_decision = agent_decision
    case.decision_source = decision_source
    case.decision_trace = decision_trace
    case.resolution = resolution
    case.resolved_by = resolved_by
    case.resolved_at = resolved_at
    db.flush()
    return ModerationCaseOut.model_validate(case)


# ---------- 审批中心与申诉（T-15-A，对外管理接口） ----------


def list_moderation_cases(
    db: Session, page: int, page_size: int, status: str | None, source: str | None,
) -> tuple[list[ModerationCaseOut], int]:
    """分页列出审核工单（最新在前；status/source 可选筛选）。"""
    query = db.query(ModerationCase)
    if status is not None:
        query = query.filter(ModerationCase.status == status)
    if source is not None:
        query = query.filter(ModerationCase.source == source)
    total = query.count()
    cases = (
        query.order_by(ModerationCase.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [ModerationCaseOut.model_validate(case) for case in cases], total


def list_executed_cases_by_recency(db: Session, limit: int = 50) -> list[ModerationCase]:
    """最近已执行工单（申诉定位候选；作者归属由 service 判定）。"""
    return (
        db.query(ModerationCase)
        .filter(ModerationCase.status == domain.CASE_STATUS_EXECUTED)
        .order_by(ModerationCase.id.desc())
        .limit(limit)
        .all()
    )


def has_pending_appeal(db: Session, case_id: int, user_id: int) -> bool:
    """同一用户对同一工单是否已有待处理申诉。"""
    return (
        db.query(Appeal)
        .filter(
            Appeal.case_id == case_id,
            Appeal.user_id == user_id,
            Appeal.status == "pending",
        )
        .first()
        is not None
    )


def has_pending_case_for_target(
    db: Session, target_type: str, target_id: int
) -> bool:
    """同一目标是否已有未结案（pending/中间态）工单——静默巡检判重（US-13，T-15-B）。

    已执行/已拒绝的终态工单不阻止再次建单（处置后复发的新违规应重新扫描）。
    """
    return (
        db.query(ModerationCase)
        .filter(
            ModerationCase.target_type == target_type,
            ModerationCase.target_id == target_id,
            ModerationCase.status.in_((
                domain.CASE_STATUS_PENDING,
                domain.CASE_STATUS_AGENT_PROPOSED,
                domain.CASE_STATUS_MANAGER_DIRECTED,
            )),
        )
        .first()
        is not None
    )


def create_appeal(db: Session, case_id: int, user_id: int, reason: str) -> AppealOut:
    """新建申诉（pending；重复与无可申诉对象由 service 层先行拦截）。"""
    appeal = Appeal(case_id=case_id, user_id=user_id, reason=reason, status="pending")
    db.add(appeal)
    db.flush()
    return AppealOut.model_validate(appeal)


def get_appeal_by_id(db: Session, appeal_id: int) -> Appeal | None:
    """按主键取申诉 ORM 对象（复核前校验）。"""
    return db.get(Appeal, appeal_id)


def list_appeals(
    db: Session, page: int, page_size: int, status: str | None,
) -> tuple[list[AppealOut], int]:
    """分页列出申诉（最新在前；status 可选筛选）。"""
    query = db.query(Appeal)
    if status is not None:
        query = query.filter(Appeal.status == status)
    total = query.count()
    appeals = (
        query.order_by(Appeal.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [AppealOut.model_validate(appeal) for appeal in appeals], total


def save_appeal_resolution(
    db: Session, appeal_id: int, *, status: str, resolution_note: str, resolved_by: int,
) -> AppealOut:
    """申诉复核结果落库（状态机与权限校验在 service 层完成）。"""
    appeal = db.query(Appeal).filter(Appeal.id == appeal_id).one()
    appeal.status = status
    appeal.resolution_note = resolution_note
    appeal.resolved_by = resolved_by
    appeal.resolved_at = datetime.now()
    db.flush()
    return AppealOut.model_validate(appeal)


def get_experience(
    db: Session, *, row_id: int | None = None, proposal_id: str | None = None,
    for_update: bool = False,
) -> ExperienceOut | None:
    query = db.query(AgentExperience)
    query = query.filter(AgentExperience.id == row_id) if row_id is not None else query.filter(
        AgentExperience.proposal_id == proposal_id,
    )
    if for_update:
        query = query.with_for_update().populate_existing()
    row = query.first()
    return ExperienceOut.model_validate(row) if row else None


def create_experience(
    db: Session, proposal_id: str, course_id: int, proposed_by: int, title: str,
    summary: str, steps: list[str], trace_id: str, agent_run_id: str,
) -> ExperienceOut:
    row = AgentExperience(
        proposal_id=proposal_id, course_id=course_id, proposed_by=proposed_by,
        title=title, summary=summary, steps=steps, status="pending", trace_id=trace_id,
        agent_run_id=agent_run_id,
    )
    db.add(row)
    db.flush()
    return ExperienceOut.model_validate(row)


def list_experiences(
    db: Session, course_id: int, *, published_only: bool = False,
) -> list[ExperienceOut]:
    query = db.query(AgentExperience).filter(AgentExperience.course_id == course_id)
    if published_only:
        query = query.filter(AgentExperience.status == "published")
    return [ExperienceOut.model_validate(row) for row in query.order_by(
        AgentExperience.id.desc(),
    ).limit(100).all()]


def decide_experience(db: Session, row_id: int, status: str, teacher_id: int) -> ExperienceOut:
    row = db.get(AgentExperience, row_id)
    row.status = status
    row.reviewed_by = teacher_id
    row.reviewed_at = datetime.now()
    db.flush()
    return ExperienceOut.model_validate(row)
