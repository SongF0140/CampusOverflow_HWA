# governance 领域规则：Agent 运行状态机、记忆类型、审批动作白名单与敏感信息过滤
# 铁律：零框架依赖——本文件不得 import fastapi / sqlalchemy / pydantic，可直接单测。
# 依据：T-12 / US-17 / US-18 / C-06 / C-07 / X-06、specs/plan.md §4/§5/§6。
from app.core.domain_error import DomainError

# ---------- Agent 运行（agent_runs / US-18） ----------

RUN_STATUS_RUNNING = "running"
RUN_STATUS_SUCCEEDED = "succeeded"
RUN_STATUS_FAILED = "failed"

# 状态机：running → succeeded / failed；终态不可再迁移（失败重跑 = 新建 run）
ALLOWED_RUN_TRANSITIONS: dict[str, set[str]] = {
    RUN_STATUS_RUNNING: {RUN_STATUS_SUCCEEDED, RUN_STATUS_FAILED},
    RUN_STATUS_SUCCEEDED: set(),
    RUN_STATUS_FAILED: set(),
}

# ---------- 持久化记忆（agent_memory / US-17，plan §4 三类） ----------

MEMORY_PREFERENCE = "preference"
MEMORY_COURSE_CONTEXT = "course_context"
MEMORY_TASK_EXPERIENCE = "task_experience"
MEMORY_TYPES = {MEMORY_PREFERENCE, MEMORY_COURSE_CONTEXT, MEMORY_TASK_EXPERIENCE}

# 任务类型 → 该任务相关的记忆类型（plan §5"按任务类型过滤"的映射；
# 映射口径可随审查调整，未登记的任务类型不按类型过滤）
TASK_MEMORY_RELEVANCE: dict[str, set[str]] = {
    "suggest_tags": {MEMORY_COURSE_CONTEXT},
    "similar_questions": {MEMORY_COURSE_CONTEXT},
    "moderation_scan": {MEMORY_TASK_EXPERIENCE},
    "doc_draft": {MEMORY_COURSE_CONTEXT, MEMORY_TASK_EXPERIENCE},
}

# 记忆读取单次上限（内部检索场景，候选有界即可）
MEMORY_LIST_LIMIT = 50

# ---------- 审批工单（moderation_cases / US-13/US-14，C-06） ----------

# Agent 可申请的高风险动作白名单（plan §4 ApprovalRequest.actionType）
APPROVAL_ACTION_TYPES = {
    "hide_content", "delete_content", "ban_user", "write_file", "call_mcp_tool",
}
# 风险等级白名单（plan §4）
APPROVAL_RISK_LEVELS = {"low", "medium", "high", "critical"}
CASE_SOURCE_AGENT = "agent"
CASE_STATUS_PENDING = "pending"

# ---------- 敏感信息过滤（X-06 / C-07：记忆内容不落密钥类原文） ----------

# 关键词黑名单（小写匹配；保守拦截，宁可误拒不放过）
SENSITIVE_KEYWORDS: tuple[str, ...] = (
    "password", "passwd", "pwd", "token", "secret", "api_key", "apikey",
    "access_key", "cookie", "authorization", "credential", "private_key",
    "密码", "口令", "密钥", "凭证",
)

# ---------- 领域异常（http_status 由 core/errors.py 统一映射） ----------


class RunNotFoundError(DomainError):
    """Agent 运行记录不存在。"""

    http_status = 404


class RunStateError(DomainError):
    """Agent 运行状态不允许该迁移（终态不可变更）。"""

    http_status = 400


class InvalidMemoryTypeError(DomainError):
    """记忆类型不合法（仅限偏好 / 课程上下文 / 任务经验三类）。"""

    http_status = 400


class MemorySensitiveError(DomainError):
    """记忆内容包含敏感信息，写入被拒绝。"""

    http_status = 400


class InvalidApprovalRequestError(DomainError):
    """审批请求不合法（动作类型或风险等级不在白名单内）。"""

    http_status = 400


class SearchKeywordError(DomainError):
    """搜索关键词不能为空。"""

    http_status = 400


# ---------- 不变量与规则 ----------


def is_sensitive_content(content: str) -> bool:
    """敏感信息判定：内容（小写化后）命中任一黑名单关键词即拒绝写入。"""
    lowered = content.lower()
    return any(keyword in lowered for keyword in SENSITIVE_KEYWORDS)


def ensure_run_transition(current: str, target: str) -> None:
    """不变量：运行状态只能沿状态机迁移，终态（succeeded/failed）不可再变更。"""
    if target not in ALLOWED_RUN_TRANSITIONS.get(current, set()):
        raise RunStateError()


def ensure_valid_memory_type(memory_type: str) -> None:
    """不变量：记忆类型必须在三类白名单内。"""
    if memory_type not in MEMORY_TYPES:
        raise InvalidMemoryTypeError()


def ensure_valid_approval(action_type: str, risk_level: str) -> None:
    """不变量：审批动作类型与风险等级必须在白名单内（拒绝 Agent 侧任意枚举）。"""
    if action_type not in APPROVAL_ACTION_TYPES or risk_level not in APPROVAL_RISK_LEVELS:
        raise InvalidApprovalRequestError()
