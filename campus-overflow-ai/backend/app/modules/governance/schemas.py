"""governance 模块 Pydantic Schema：/internal/agent/* 内部接口的请求与出参（蛇形字段）。

内部 API 契约依据 specs/plan.md §5（8 个白名单接口）；服务间调用，
鉴权走 X-Service-Token（不走用户 JWT）。摘要字段只存摘要，不落敏感原文。
"""
from datetime import datetime

from pydantic import BaseModel, Field

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
    trace_id: str | None = None
    agent_run_id: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
