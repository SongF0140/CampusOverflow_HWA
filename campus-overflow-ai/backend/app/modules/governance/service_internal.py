# governance 内部业务层：/internal/agent/* 白名单接口的用例编排（T-12）
# 分层基线 D-2/D-5：ORM 留在 repository；课程/问题检索经 courses/qa 公开 service 只读复用，
# 用户存在性经 identity 公开 service 校验；本层不 import models、不依赖 Web 框架。
# 事务约定 D-8：写用例末尾显式 db.commit()。
import uuid

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
from app.modules.qa.schemas import QuestionListItemResponse

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

    tags 为逗号分隔标签名，作为候选集内的包含筛选（limit 有界，页面语义
    不变）；keyword 必填，命中标题或正文（与业务搜索同款转义）。
    """
    keyword = keyword.strip()
    if not keyword:
        raise domain.SearchKeywordError()
    wanted = {t.strip() for t in tags.split(",") if t.strip()} if tags else set()
    items, total = qa_service.list_questions(
        db, 1, limit, course_id, QUESTION_SORT_LATEST, False, keyword
    )
    if wanted:
        items = [i for i in items if any(t.name in wanted for t in i.tags)]
    return items, total
