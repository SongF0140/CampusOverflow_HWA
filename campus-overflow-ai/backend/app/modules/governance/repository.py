# governance 数据访问：agent_runs / tool_call_logs / agent_memory / moderation_cases
# 分层基线 D-2：本文件是模块内唯一允许 import models 的地方；出参一律 schemas。
# 事务约定 D-8：本层只 flush 不 commit，事务边界（commit）在 service 用例层。
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.modules.governance import domain
from app.modules.governance.models import AgentMemory, AgentRun, ModerationCase, ToolCallLog
from app.modules.governance.schemas import (
    AgentRunOut,
    MemoryItemOut,
    ModerationCaseOut,
    ToolCallOut,
)

# ---------- Agent 运行（agent_runs） ----------


def create_run(
    db: Session, task_type: str, trace_id: str, agent_run_id: str, input_summary: str
) -> AgentRunOut:
    """新建运行记录，初始状态 running；agent_run_id 冲突由唯一索引兜底。"""
    run = AgentRun(
        task_type=task_type,
        trace_id=trace_id,
        agent_run_id=agent_run_id,
        input_summary=input_summary,
        status=domain.RUN_STATUS_RUNNING,
    )
    db.add(run)
    db.flush()
    return AgentRunOut.model_validate(run)


def get_run_by_agent_run_id(db: Session, agent_run_id: str) -> AgentRunOut | None:
    """按运行标识查询（内部接口以 agent_run_id 字符串为定位键）。"""
    run = db.query(AgentRun).filter(AgentRun.agent_run_id == agent_run_id).first()
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
) -> ModerationCaseOut:
    """Agent 来源工单落表：source=agent、status=pending，处置字段全部留空。"""
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
    )
    db.add(case)
    db.flush()
    return ModerationCaseOut.model_validate(case)
