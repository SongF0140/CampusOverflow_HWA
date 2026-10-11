# governance 内部业务层：/internal/agent/* 白名单接口的用例编排（T-12）
# 分层基线 D-2/D-5：ORM 留在 repository；课程/问题检索经 courses/qa 公开 service 只读复用，
# 用户存在性经 identity 公开 service 校验；本层不 import models、不依赖 Web 框架。
# 事务约定 D-8：写用例末尾显式 db.commit()。
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.logging import action_logger
from app.modules.courses import service as courses_service
from app.modules.courses.schemas import CourseListItemResponse
from app.modules.governance import domain, repository
from app.modules.governance.schemas import (
    AgentRunOut,
    MemoryItemOut,
    ModerationCaseOut,
    ToolCallOut,
)
from app.modules.identity import service as identity_service
from app.modules.qa import service as qa_service
from app.modules.qa.schemas import QuestionListItemResponse, TagBrief

# 问题检索排序口径：复用 qa 列表 latest（vote_score 之外的默认序）
QUESTION_SORT_LATEST = "latest"


# ---------- Agent 运行（US-18） ----------


def create_run(
    db: Session, task_type: str, trace_id: str, input_summary: str,
    agent_run_id: str | None = None,
) -> AgentRunOut:
    """创建运行记录：agent_run_id 优先取 Agent 上报（T-11 生成），缺省后端兜底。"""
    run = repository.create_run(
        db, task_type, trace_id, agent_run_id or uuid.uuid4().hex, input_summary
    )
    db.commit()
    action_logger.info(
        "agent_run_created agent_run_id=%s task_type=%s trace_id=%s",
        run.agent_run_id, task_type, trace_id,
    )
    return run


def update_run(
    db: Session, agent_run_id: str, status: str,
    output_summary: str | None, error_summary: str | None,
) -> AgentRunOut:
    """更新运行结果：先读当前状态过状态机（D-1），非法迁移 400，记录不存在 404。"""
    current = repository.get_run_by_agent_run_id(db, agent_run_id)
    if current is None:
        raise domain.RunNotFoundError()
    domain.ensure_run_transition(current.status, status)
    run = repository.update_run(db, agent_run_id, status, output_summary, error_summary)
    db.commit()
    return run


def record_tool_call(
    db: Session, agent_run_id: str, tool_name: str, args_summary: str | None,
    result_summary: str | None, status: str, duration_ms: int | None, trace_id: str,
) -> ToolCallOut:
    """记录工具调用摘要：运行不存在 404；摘要内容敏感过滤由 Agent 侧白名单保证。"""
    if repository.get_run_by_agent_run_id(db, agent_run_id) is None:
        raise domain.RunNotFoundError()
    log = repository.create_tool_call(
        db, agent_run_id, tool_name, args_summary, result_summary, status, duration_ms, trace_id
    )
    db.commit()
    return log


# ---------- 持久化记忆（US-17 / X-06） ----------


def write_memory(
    db: Session, user_id: int, memory_type: str, content: str,
    course_id: int | None, source_run_id: str | None, trace_id: str,
) -> MemoryItemOut:
    """写入记忆：用户必须存在；类型白名单；敏感内容拒绝并留拦截日志（不含原文）。"""
    identity_service.get_by_id(db, user_id)  # 不存在 → 404
    domain.ensure_valid_memory_type(memory_type)
    if domain.is_sensitive_content(content):
        # 拦截日志只留元信息，不落内容原文（C-07）
        action_logger.warning(
            "agent_memory_intercepted user_id=%s trace_id=%s reason=sensitive_keyword",
            user_id, trace_id,
        )
        raise domain.MemorySensitiveError()
    item = repository.create_memory(db, user_id, memory_type, content, course_id, source_run_id)
    db.commit()
    return item


def list_memories(
    db: Session, user_id: int, task_type: str | None,
    memory_type: str | None, course_id: int | None,
) -> list[MemoryItemOut]:
    """读取相关记忆：用户/课程/类型过滤（plan §5）；task_type 经领域映射取相关类型。"""
    identity_service.get_by_id(db, user_id)  # 不存在 → 404
    if memory_type:
        domain.ensure_valid_memory_type(memory_type)
        memory_types = [memory_type]
    elif task_type:
        memory_types = sorted(domain.TASK_MEMORY_RELEVANCE.get(task_type, set()))
    else:
        memory_types = None
    return repository.list_memories(db, user_id, course_id, memory_types)


# ---------- 审批工单（US-13 / US-14 / C-06：只建工单，绝不执行） ----------


def create_approval(
    db: Session, action_type: str, risk_level: str, payload_snapshot: str,
    trace_id: str, agent_run_id: str | None,
    target_type: str | None, target_id: int, reason: str | None,
) -> ModerationCaseOut:
    """高风险动作 → moderation_cases 工单（source=agent、status=pending）。

    红线（C-06）：本函数只落工单留痕，不隐藏/不删除/不封号/不写文件；
    处置由管理员经治理接口执行（T-15）。动作与风险等级经白名单校验。
    """
    domain.ensure_valid_approval(action_type, risk_level)
    case_reason = reason or f"Agent 高风险动作待人工审批：{action_type}（风险等级 {risk_level}）"
    case = repository.create_agent_case(
        db, target_type or "agent_action", target_id, risk_level,
        case_reason, payload_snapshot, trace_id, agent_run_id,
    )
    db.commit()
    action_logger.info(
        "agent_approval_ticket_created case_id=%s action_type=%s risk_level=%s "
        "trace_id=%s agent_run_id=%s",
        case.id, action_type, risk_level, trace_id, agent_run_id,
    )
    return case


# ---------- 站内检索（US-09 / US-10 / US-12：只读复用现有 service） ----------


def search_courses(
    db: Session, keyword: str, limit: int
) -> tuple[list[CourseListItemResponse], int]:
    """课程检索（plan §5）：复用 courses 公开列表查询，按关键词过滤。"""
    keyword = keyword.strip()
    if not keyword:
        raise domain.SearchKeywordError()
    return courses_service.list_courses(db, 1, limit, keyword, None)


def search_questions(
    db: Session, keyword: str, course_id: int | None, tags: str | None, limit: int
) -> tuple[list[QuestionListItemResponse], int]:
    """相似问题候选检索（plan §5）：复用 qa 公开列表查询（软删不可见 E-10）。

    tags 为逗号分隔标签名，任一标签命中即保留，计数与 limit 前由 qa 查询过滤；
    keyword 必填，命中标题或正文（与业务搜索同款转义）。
    """
    keyword = keyword.strip()
    if not keyword:
        raise domain.SearchKeywordError()
    wanted = sorted({t.strip() for t in tags.split(",") if t.strip()}) if tags else None
    return qa_service.list_questions(
        db, 1, limit, course_id, QUESTION_SORT_LATEST, False, keyword,
        tag_names=wanted,
    )


def list_tags(db: Session, limit: int) -> list[TagBrief]:
    """站内标签词表（plan §5 / US-11 / E-09）：标签推荐的候选集，只读复用 qa 标签列表。

    全量按 id 升序取前 limit 个（词表只供候选与站内 id 映射，不附绑定计数）；
    E-09：仅提供词表，绑定仍须用户确认后经 qa 标签绑定接口写入。
    """
    return [
        TagBrief(id=t.id, name=t.name, type=t.type)
        for t in qa_service.list_tags(db, None, False)[:limit]
    ]


# ---------- 工单决策（T-16 双环工作流） ----------

def update_case_agent_decision(
    db: Session,
    case_id: int,
    manager_feedback: str,
    decision: str,
    *,
    caller_is_admin: bool,
    principal_id: int | None,
    trace_id: str,
    decision_source: str | None = None,
    skip_reason: str | None = None,
    agent_run_id: str | None = None,
) -> ModerationCaseOut:
    """工单决策推进：严格按双环状态机迁移，并按调用方身份守住执行边界。

    双环工作流（T-16 / C-06）：
      pending → (agent_proposed | manager_directed) → (executed | rejected)

    权限矩阵：
      - pending：Agent（服务 token）只能走 agent_proposed；
        manager_directed 通道仅管理员（JWT）可开启。
      - agent_proposed → executed（hide/delete/resolve）：仅管理员，人工确认留痕；
        Agent 只能以 skip 安全自终止为 rejected。
      - manager_directed 通道的关闭（执行/拒绝）：仅管理员。

    决策来源在进入中间态时确定并冻结，终态迁移不覆盖。
    """
    case = repository.get_case_by_id(db, case_id)
    if case is None:
        raise domain.DecisionNotFoundError()

    current_status = case.status
    if current_status in {domain.CASE_STATUS_EXECUTED, domain.CASE_STATUS_REJECTED}:
        raise domain.CaseTransitionError("终态工单不可变更")
    if decision not in domain.CASE_ALLOWED_DECISIONS:
        raise domain.CaseDecisionError("decision 不在允许的取值内")

    is_execution = decision in domain.CASE_EXECUTION_DECISIONS

    if current_status == domain.CASE_STATUS_PENDING:
        source = decision_source or domain.CASE_STATUS_AGENT_PROPOSED
        if source not in {
            domain.CASE_STATUS_AGENT_PROPOSED, domain.CASE_STATUS_MANAGER_DIRECTED
        }:
            raise domain.CaseDecisionError("decision_source 不合法")
        if source == domain.CASE_STATUS_MANAGER_DIRECTED and not caller_is_admin:
            raise domain.CaseActionForbiddenError("管理员直办通道只能由管理员开启")
        target_status = source
        resolution = None
        resolved_by = None
        resolved_at = None
    elif current_status == domain.CASE_STATUS_AGENT_PROPOSED:
        if is_execution and not caller_is_admin:
            # C-06：Agent 不得凭服务 token 直接执行处置，必须等待管理员确认
            raise domain.CaseActionForbiddenError("处置执行必须经管理员人工确认")
        if is_execution:
            target_status = domain.CASE_STATUS_EXECUTED
            resolution = decision
            resolved_by = principal_id
            resolved_at = datetime.now(timezone.utc)
        else:
            target_status = domain.CASE_STATUS_REJECTED
            resolution = None
            # Agent 自终止没有操作人；管理员拒绝时留管理员痕
            resolved_by = principal_id if caller_is_admin else None
            resolved_at = datetime.now(timezone.utc)
    elif current_status == domain.CASE_STATUS_MANAGER_DIRECTED:
        if not caller_is_admin:
            raise domain.CaseActionForbiddenError("管理员直办通道只能由管理员关闭")
        if is_execution:
            target_status = domain.CASE_STATUS_EXECUTED
            resolution = decision
        else:
            target_status = domain.CASE_STATUS_REJECTED
            resolution = None
        resolved_by = principal_id
        resolved_at = datetime.now(timezone.utc)
    else:
        raise domain.CaseTransitionError(f"不支持的工单状态 {current_status}")

    # 防御性不变量：目标迁移必须在状态机白名单内
    domain.ensure_case_transition(current_status, target_status)

    saved = repository.save_case_decision(
        db,
        case_id,
        status=target_status,
        manager_feedback=manager_feedback,
        agent_decision=decision,
        decision_source=case.decision_source
        if current_status != domain.CASE_STATUS_PENDING else source,
        resolution=resolution,
        resolved_by=resolved_by,
        resolved_at=resolved_at,
    )
    db.commit()

    action_logger.info(
        "case_decided case_id=%s from=%s to=%s decision=%s is_execution=%s "
        "caller_is_admin=%s principal_id=%s skip_reason_present=%s "
        "agent_run_id=%s trace_id=%s",
        case_id, current_status, target_status, decision, is_execution,
        caller_is_admin, principal_id, bool(skip_reason), agent_run_id, trace_id,
    )

    return saved
