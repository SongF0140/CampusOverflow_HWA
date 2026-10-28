"""governance 模块 Pydantic Schema：/internal/agent/* 内部接口的请求与出参（蛇形字段）。

内部 API 契约依据 specs/plan.md §5（8 个白名单接口）；服务间调用，
通用接口鉴权走 X-Service-Token；身份解析同时验证用户 JWT，决策接口另有混合认证。
摘要字段只存摘要，不落敏感原文。
"""
from datetime import date, datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.modules.courses.schemas import HeatmapItem, UncoveredTopicItem
from app.modules.qa.schemas import ModerationContentData


class AgentPrincipalOut(BaseModel):
    """Agent 使用的最小身份上下文，不含个人资料或认证凭证。"""

    user_id: int
    role: str
    status: str
    identity_type: str
    assistant_cert_status: str


class AgentPrincipalResponse(BaseModel):
    """身份解析成功信封，固定现有 code/data/message 契约。"""

    code: Literal[200] = 200
    data: AgentPrincipalOut
    message: str


class ModerationTargetResponse(BaseModel):
    """只读正文接口成功信封。"""

    code: Literal[200] = 200
    data: ModerationContentData
    message: str = "success"


class GovernanceTargetStateOut(BaseModel):
    """管理员治理前读取的最小状态；不代表后续处置已获授权。"""

    target_type: Literal["question", "answer", "comment", "user"]
    target_id: int = Field(ge=1)
    current_state: Literal["ready", "missing", "deleted", "hidden", "active", "banned"]
    state_version: str | None = None


class GovernanceTargetStateResponse(BaseModel):
    code: Literal[200] = 200
    data: GovernanceTargetStateOut
    message: str = "success"


class GovernanceRequestCreate(BaseModel):
    model_config = {"extra": "forbid", "str_strip_whitespace": True}

    request_id: UUID
    expected_version: str = Field(pattern=r"^[0-9a-f]{64}$")
    target_type: Literal["question", "answer", "comment", "user"]
    target_id: int = Field(gt=0, strict=True)
    action: Literal["hide", "delete", "ban", "ban_temp", "warn"]
    reason: str = Field(min_length=1, max_length=500)
    duration_days: int | None = Field(None, ge=1, le=30, strict=True)

    @model_validator(mode="after")
    def check_action(self) -> Self:
        if (self.action in {"hide", "delete"}) == (self.target_type == "user"):
            raise ValueError("动作与目标类型不匹配")
        if self.action != "ban_temp" and self.duration_days is not None:
            raise ValueError("只有限时封禁可以指定期限")
        if self.action == "ban_temp" and self.duration_days is None:
            self.duration_days = 7
        return self


class FrozenApprovalSnapshot(GovernanceRequestCreate):
    contract: Literal["approval-v1"]
    requester_id: int = Field(gt=0)


class GovernanceRequestOut(BaseModel):
    request_id: str
    case_id: int
    agent_run_id: str
    target_type: str
    target_id: int
    action: str
    duration_days: int | None = None
    status: str
    repeat: bool


# ---------- 记忆（US-17 / C-07 / X-06） ----------


class MemoryWriteRequest(BaseModel):
    """写入记忆请求（plan §5：userId / memoryType / content / sourceRunId）。

    course_id 为可选课程上下文（plan §6 存储键），敏感内容过滤在 service 层。
    """

    user_id: int = Field(..., description="记忆归属用户")
    memory_type: str = Field(
        ..., min_length=1, max_length=20,
        description="preference / course_context / task_experience",
    )
    content: str = Field(..., min_length=1, description="记忆正文（写入前做敏感信息过滤）")
    course_id: int | None = Field(None, description="可选关联课程")
    source_run_id: str | None = Field(None, max_length=64, description="来源 Agent 运行标识")


class MemoryItemOut(BaseModel):
    """记忆条目出参。"""

    id: int
    user_id: int
    memory_type: str
    content: str
    course_id: int | None = None
    source_run_id: str | None = None
    is_enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- Agent 运行（US-18 / C-08） ----------


class RunCreateRequest(BaseModel):
    """创建运行记录请求（plan §5：taskType / traceId / inputSummary）。

    agent_run_id 可由 Agent 服务传入（T-11 生成）；缺省由后端兜底生成。
    trace_id 缺省回落到 X-Trace-Id 请求头。
    """

    task_type: str = Field(..., min_length=1, max_length=50, description="任务类型")
    agent_run_id: str | None = Field(
        None, max_length=64, description="Agent 生成的运行标识（可选）"
    )
    trace_id: str | None = Field(None, max_length=64, description="追踪 id（可选，缺省取请求头）")
    input_summary: str = Field(..., min_length=1, description="输入摘要（不落敏感原文）")


class RunUpdateRequest(BaseModel):
    """更新运行结果请求（plan §5：status / outputSummary? / errorSummary?）。"""

    status: str = Field(
        ..., min_length=1, max_length=20, description="running / succeeded / failed"
    )
    output_summary: str | None = Field(None, description="输出摘要")
    error_summary: str | None = Field(None, description="失败原因摘要")


class AgentRunOut(BaseModel):
    """运行记录出参。"""

    id: int
    user_id: int | None = None
    task_type: str
    trace_id: str
    agent_run_id: str
    input_summary: str
    output_summary: str | None = None
    error_summary: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- 工具调用日志（US-18 / C-08） ----------


class ToolCallCreateRequest(BaseModel):
    """记录工具调用摘要请求（plan §5：agentRunId / toolName / 摘要与状态）。"""

    agent_run_id: str = Field(..., min_length=1, max_length=64, description="关联运行标识")
    tool_name: str = Field(
        ..., min_length=1, max_length=100, description="工具名（须在 Agent 白名单注册）"
    )
    args_summary: str | None = Field(None, description="参数摘要（不落原始密钥）")
    result_summary: str | None = Field(None, description="结果摘要（不落隐私原文）")
    status: str = Field(..., min_length=1, max_length=20, description="单次调用状态")
    duration_ms: int | None = Field(None, ge=0, description="耗时毫秒")


class ToolCallOut(BaseModel):
    """工具调用日志出参。"""

    id: int
    agent_run_id: str
    tool_name: str
    args_summary: str | None = None
    result_summary: str | None = None
    status: str
    duration_ms: int | None = None
    trace_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentRunResponse(BaseModel):
    code: Literal[200] = 200
    data: AgentRunOut
    message: str


class ToolCallResponse(BaseModel):
    code: Literal[200] = 200
    data: ToolCallOut
    message: str


class AuditPlanStep(BaseModel):
    model_config = {"extra": "forbid"}
    step_id: str = Field(..., pattern=r"^s\d+$", max_length=20)
    tool_name: Literal["searchCourses", "searchQuestions", "fetchTags", "fetchModerationTarget"]


class RunEventCreateRequest(BaseModel):
    model_config = {"extra": "forbid"}
    event_type: Literal["plan", "step_started", "step_succeeded", "step_failed"]
    plan_revision: int = Field(..., ge=1, le=2)
    steps: list[AuditPlanStep] | None = Field(None, max_length=8)
    step_id: str | None = Field(None, pattern=r"^s\d+$", max_length=20)
    tool_name: (
        Literal["searchCourses", "searchQuestions", "fetchTags", "fetchModerationTarget"] | None
    ) = None
    duration_ms: int | None = Field(None, ge=0)


class RunEventOut(RunEventCreateRequest):
    model_config = {"from_attributes": True, "extra": "ignore"}
    id: int
    agent_run_id: str
    sequence_no: int
    trace_id: str
    created_at: datetime


class RunEventResponse(BaseModel):
    code: Literal[200] = 200
    data: RunEventOut
    message: str = "运行事件已记录"


# ---------- 审批工单（US-13 / US-14 / C-06） ----------


class ApprovalCreateRequest(BaseModel):
    """创建审批工单请求（plan §5：actionType / riskLevel / payloadSnapshot / traceId）。

    只落 moderation_cases 工单（status=pending），绝不执行处置动作（C-06）；
    target_type / target_id / reason / agent_run_id 为落表必需的补充可选字段。
    """

    action_type: str = Field(
        ..., min_length=1, max_length=30, description="高风险动作类型（白名单校验）"
    )
    risk_level: str = Field(
        ..., min_length=1, max_length=20, description="风险等级 low/medium/high/critical"
    )
    payload_snapshot: str = Field(..., min_length=1, description="目标对象快照摘要")
    trace_id: str | None = Field(None, max_length=64, description="追踪 id（可选，缺省取请求头）")
    agent_run_id: str | None = Field(None, max_length=64, description="来源运行标识")
    target_type: str | None = Field(
        None, max_length=20, description="目标类型（缺省 agent_action）"
    )
    target_id: int = Field(0, description="目标 id（目标详情在快照内）")
    reason: str | None = Field(None, max_length=500, description="申请理由（缺省按动作类型生成）")


class ModerationCaseOut(BaseModel):
    """审批工单出参（只读视图，处置字段不开放给 Agent）。"""

    id: int
    target_type: str
    target_id: int
    risk_level: str
    source: str
    reason: str
    snapshot: str | None = None
    status: str
    manager_feedback: str | None = None  # 管理员反馈
    agent_decision: str | None = None    # Agent 最终决策
    decision_source: str | None = None   # agent_proposed / manager_directed
    decision_trace: str | None = None    # 追加式决策轨迹（建单首行 + 每次推进）
    resolution: str | None = None        # 对外暴露的处置动作
    resolved_by: int | None = None
    resolved_at: datetime | None = None
    trace_id: str | None = None
    agent_run_id: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- 决策更新（T-16 扩展） ----------

class DecisionUpdateRequest(BaseModel):
    """Agent 决策更新请求（plan T-16 双环）。"""

    manager_feedback: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="管理员对 Agent 的判断解释",
    )
    decision: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="处置决策：skip / hide / delete / ban（US-14）",
    )
    decision_source: str | None = Field(
        None,
        max_length=20,
        description="决策来源：agent_proposed / manager_directed",
    )
    skip_reason: str | None = Field(
        None, max_length=500, description="决策跳过原因（仅审计日志，不落库）"
    )


# ---------- 周报与知识树（KN-R01/R02，K-02） ----------


class ReportSaveRequest(BaseModel):
    """周报保存请求（系统调度运行提交，服务级接口）。"""

    course_id: int = Field(..., description="课程 ID")
    week_start: date = Field(..., description="周起始日期")
    week_end: date = Field(..., description="周结束日期")
    content: str = Field(..., min_length=1, max_length=20000, description="周报正文")
    uncovered_topics: list[UncoveredTopicItem] = Field(
        ..., max_length=50, description="提问集中但知识树未覆盖的主题"
    )
    heatmap: list[HeatmapItem] = Field(
        ..., max_length=200, description="各知识点提问热力分布"
    )
    question_count: int = Field(..., ge=0, description="本周问题总数")
    agent_run_id: str = Field(..., min_length=1, max_length=64, description="溯源运行 ID")


# ---------- 审批中心与申诉（T-15-A，对外管理接口） ----------


class CaseResolveRequest(BaseModel):
    """管理员处置审核工单请求（双环决策白名单 hide/delete/ban/ban_temp/warn/skip）。"""

    decision: str = Field(
        ..., description="处置动作：hide / delete / ban / ban_temp / warn / skip"
    )
    manager_feedback: str = Field(
        ..., min_length=1, max_length=2000, description="管理员处置说明（留痕）"
    )
    # 仅 ban_temp 使用；缺省 7 天，1~30 天
    duration_days: int | None = Field(
        None, ge=1, le=30, description="限时封禁天数（仅 ban_temp）"
    )


class AppealCreateRequest(BaseModel):
    """学生提交申诉请求（与前端 AppealFormView 契约一致：仅理由字段）。"""

    reason: str = Field(..., min_length=1, max_length=500, description="申诉理由，30~500 字")


class AppealResolveRequest(BaseModel):
    """管理员复核申诉请求。"""

    resolution: str = Field(..., description="accepted（撤销处置）/ rejected（维持处置）")
    resolution_note: str = Field(
        ..., min_length=1, max_length=500, description="复核说明（通知当事人）"
    )


class AppealOut(BaseModel):
    """申诉出参。"""

    id: int
    case_id: int
    user_id: int
    reason: str
    status: str
    resolution_note: str | None = None
    resolved_by: int | None = None
    resolved_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---------- 观测与审计（T-16-A，US-18/C-08） ----------


class RunEventOut(BaseModel):
    """运行事件出参（观测详情用）。"""

    id: int
    agent_run_id: str
    sequence_no: int
    event_type: str
    plan_revision: int
    steps: list[dict] | None = None
    step_id: str | None = None
    tool_name: str | None = None
    duration_ms: int | None = None
    trace_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RunTraceDetail(BaseModel):
    """按运行聚合的完整调用链（US-18 完成判定：trace 可检索、失败可定位）。

    trace_id 贯穿运行/事件/工具调用/关联工单，四段同响应返回。
    """

    run: AgentRunOut
    events: list[RunEventOut]
    tool_calls: list[ToolCallOut]
    related_cases: list[ModerationCaseOut]


class PatrolCaseCreateRequest(BaseModel):
    """静默巡检建单请求（Agent 调度器提交评估结果，US-13 / T-15-B）。"""

    target_type: Literal["question", "answer", "comment"] = Field(
        ..., description="目标内容类型"
    )
    target_id: int = Field(..., ge=1, description="目标内容 ID")
    risk_level: Literal["low", "medium", "high"] = Field(
        ..., description="模型评估风险等级"
    )
    reason: str = Field(
        ..., min_length=1, max_length=500, description="风险原因（不含正文原文）"
    )
    snapshot: str = Field(
        ..., min_length=1, max_length=2000, description="目标内容快照（截断摘要）"
    )
    agent_run_id: str = Field(..., min_length=1, max_length=64, description="巡检运行标识")
