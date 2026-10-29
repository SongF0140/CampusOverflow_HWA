# 治理模型：审核工单（ModerationCase）、申诉（Appeal）与 Agent 观测/记忆三表（T-12）
# agent_runs / tool_call_logs / agent_memory 服务于 /internal/agent/* 白名单接口：
# 观测字段只存摘要（禁止原始密钥/密码/隐私原文，宪法 C-07/C-08）。
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ModerationCase(Base):
    """审核工单：由 Agent 或管理员创建，记录目标内容快照与处置状态。

    约束（宪法 C-06）：Agent 无法直接隐藏/删除/封号，只能创建工单，
    全部处置动作由管理员在本表留痕。

    双环工作流（T-16 扩展）：
    - manager_feedback: 管理员对 Agent 的判断解释
    - agent_decision: Agent 基于管理员反馈的最终决策摘要
    - decision_source: agent_proposed / manager_directed
    """

    __tablename__ = "moderation_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 目标内容：question / answer / comment / user
    target_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # 风险分级：low（仅打标）/ mid / high（建工单）
    risk_level: Mapped[str] = mapped_column(String(20), nullable=False, default="low")
    # 创建来源：agent / admin
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="admin")
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    # 目标内容快照（JSON 文本），保证处置时内容可追溯（E-10）
    snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 状态：新增 agent_proposed / manager_directed / executed / rejected
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)

    # 对外暴露的处置动作：ignore / edit / hide / delete / warn / ban_temp / ban_perm
    resolution: Mapped[str | None] = mapped_column(String(20), nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # 双环工作流字段
    manager_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)  # 管理员反馈
    agent_decision: Mapped[str | None] = mapped_column(Text, nullable=True)    # Agent 最终决策
    decision_source: Mapped[str | None] = mapped_column(
        String(20), nullable=True
)  # agent_proposed / manager_directed

    # 追加式决策轨迹（2026-10-12 修复）：每行 [UTC 时间戳] actor 迁移 decision | 摘要；
    # 建单首行，每次决策追加，旧值字段覆盖语义下仍可完整追溯
    decision_trace: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 追踪字段（二期 Agent 接入后启用）
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    agent_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ApprovalWait(Base):
    """审批续接检查点；不存私聊与可执行脚本，工单是处置真值源。"""

    __tablename__ = "approval_waits"
    request_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("moderation_cases.id"), unique=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(20), default="waiting", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Appeal(Base):
    """申诉：被封禁/被处置用户对工单结果发起复核（US-16）。"""

    __tablename__ = "appeals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("moderation_cases.id"), nullable=False, index=True
    )
    # 申诉人（即被处置用户）
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    # 状态：pending / accepted（撤销处置）/ rejected（维持处置）
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    resolution_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class AgentRun(Base):
    """Agent 运行记录（US-18/C-08）：一次 Agent Loop 执行的可追踪单元。

    agent_run_id 为跨服务引用键（Agent 服务生成，缺省由后端兜底生成），
    与 tool_call_logs / moderation_cases.agent_run_id 关联；按 trace_id 可检索调用链。
    """

    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 归属快照：历史服务运行无用户；不设外键，保留用户删除后的审计标识。
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # 任务类型：suggest_tags / similar_questions / moderation_scan / doc_draft（plan §4）
    task_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    # 跨服务追踪 id（x-trace-id 透传）
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Agent 运行唯一标识（字符串，全链路互相关联的键）
    agent_run_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    # 运行输入/输出/失败摘要（只存摘要，不落原始密钥与隐私原文，C-07/C-08）
    input_summary: Mapped[str] = mapped_column(Text, nullable=False)
    output_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 状态机：running → succeeded / failed（governance/domain 校验迁移）
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="running", index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AgentRunEvent(Base):
    """追加式运行事件，仅保存计划元数据与步骤状态。"""

    __tablename__ = "agent_run_events"
    __table_args__ = (
        UniqueConstraint("agent_run_id", "sequence_no", name="uq_run_event_sequence"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_run_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("agent_runs.agent_run_id"), nullable=False, index=True,
    )
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    plan_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    steps: Mapped[list[dict[str, str]] | None] = mapped_column(JSON, nullable=True)
    step_id: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False,
    )


class ToolCallLog(Base):
    """Agent 工具调用摘要日志（US-18/C-08）：只存工具名与参数/结果摘要。

    红线（plan §6）：禁止保存 API Key、Cookie、密码、完整隐私原文——字段即摘要。
    """

    __tablename__ = "tool_call_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 关联 AgentRun.agent_run_id（字符串引用键，唯一索引可作 FK 目标）
    agent_run_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("agent_runs.agent_run_id"), nullable=False, index=True
    )
    tool_name: Mapped[str] = mapped_column(String(100), nullable=False)
    args_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 单次调用状态：success / failed 等（由 Agent 上报）
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class AgentMemory(Base):
    """Agent 持久化记忆（US-17/C-07）：用户偏好 / 课程上下文 / 任务经验三类。

    写入前经 service 敏感信息过滤（X-06）；用户可禁用（is_enabled）或删除
    影响自己的记忆（管理接口随 T-14）。course_id 为软引用（不设 FK，
    同 ModerationCase.target_id 的跨模块快照语义）。
    """

    __tablename__ = "agent_memory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    # 类型：preference / course_context / task_experience（plan §4 三类）
    memory_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 课程上下文可选（plan §6 存储键 user_id + memory_type + course_id? + source_run_id）
    course_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    source_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class CourseTagSource(Base):
    """教师/教材显式维护的课程词表，不自动信任旧 custom 标签。"""

    __tablename__ = "course_tag_sources"
    __table_args__ = (UniqueConstraint("course_id", "tag_id", name="uq_course_tag_source"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(Integer, ForeignKey("courses.id"), index=True)
    tag_id: Mapped[int] = mapped_column(Integer, ForeignKey("tags.id"))
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source_ref: Mapped[str | None] = mapped_column(String(500), nullable=True)
    maintained_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))


class AnonymousLearningEvent(Base):
    """最小学习事件，无用户、会话、原文或个人记忆字段。"""

    __tablename__ = "anonymous_learning_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    course_id: Mapped[int] = mapped_column(Integer, ForeignKey("courses.id"), index=True)
    tag_ids: Mapped[list[int]] = mapped_column(JSON, nullable=False)
    knowledge_node_ids: Mapped[list[int]] = mapped_column(JSON, nullable=False)
    question_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class ClassChangeRequest(Base):
    """教师确认的班级名单变更，不与管理员治理混用。"""

    __tablename__ = "class_change_requests"
    request_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    teacher_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    course_id: Mapped[int] = mapped_column(Integer, ForeignKey("courses.id"), index=True)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AgentExperience(Base):
    """回答经验建议；只有负责教师发布后才可进入课程上下文。"""

    __tablename__ = "agent_experiences"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    proposal_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    course_id: Mapped[int] = mapped_column(Integer, ForeignKey("courses.id"), index=True)
    proposed_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str] = mapped_column(String(1000), nullable=False)
    steps: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    trace_id: Mapped[str] = mapped_column(String(64), nullable=False)
    agent_run_id: Mapped[str] = mapped_column(String(64), nullable=False)
    reviewed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False,
    )
