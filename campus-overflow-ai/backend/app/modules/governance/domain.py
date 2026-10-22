# governance 领域规则：Agent 运行状态机、记忆类型、审批动作白名单与敏感信息过滤
# 铁律：零框架依赖——本文件不得 import fastapi / sqlalchemy / pydantic，可直接单测。
# 依据：T-12 / US-17 / US-18 / C-06 / C-07 / X-06、specs/plan.md §4/§5/§6。
import re

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


# ---------- 工单处置状态机（T-16 扩展） ----------

# 新增状态
CASE_STATUS_PENDING = "pending"         # 待管理员处理
CASE_STATUS_AGENT_PROPOSED = "agent_proposed"  # Agent 已基于反馈提出决策
CASE_STATUS_MANAGER_DIRECTED = "manager_directed"  # 管理员直接执行
CASE_STATUS_EXECUTED = "executed"      # 已执行处置
CASE_STATUS_REJECTED = "rejected"      # 决策被拒绝（Agent 不执行）

# 完整状态机
# 注：pending → rejected 为 skip 专属单边（安全自终止一次结案，2026-10-12 修复）；
# hide/delete/ban 在 pending 下只能先进中间态，不得直达终态。
ALLOWED_CASE_TRANSITIONS = {
    CASE_STATUS_PENDING: {
        CASE_STATUS_AGENT_PROPOSED, CASE_STATUS_MANAGER_DIRECTED, CASE_STATUS_REJECTED,
    },
    CASE_STATUS_AGENT_PROPOSED: {CASE_STATUS_EXECUTED, CASE_STATUS_REJECTED},
    CASE_STATUS_MANAGER_DIRECTED: {CASE_STATUS_EXECUTED, CASE_STATUS_REJECTED},
    CASE_STATUS_EXECUTED: set(),  # 终态
    CASE_STATUS_REJECTED: set(),  # 终态
}

# 决策值白名单（2026-10-12 校正到 US-14 词汇）：
# skip 为放弃/安全自终止（不执行处置）；hide/delete 作用于内容；ban 作用于人。
# resolve（与 qa"采纳解决"语义冲突的假处置值）已移除；
# warn（通知能力 US-15 未交付）/edit（要求修改流程未建）本期不开放。
CASE_DECISION_HIDE = "hide"
CASE_DECISION_DELETE = "delete"
CASE_DECISION_BAN = "ban"
CASE_DECISION_SKIP = "skip"
CASE_EXECUTION_DECISIONS = {
    CASE_DECISION_HIDE, CASE_DECISION_DELETE, CASE_DECISION_BAN,
}
CASE_ALLOWED_DECISIONS = CASE_EXECUTION_DECISIONS | {CASE_DECISION_SKIP}

# 工单目标类型：内容三类 + 用户
CASE_TARGET_QUESTION = "question"
CASE_TARGET_ANSWER = "answer"
CASE_TARGET_COMMENT = "comment"
CASE_TARGET_USER = "user"
CASE_CONTENT_TARGETS = {CASE_TARGET_QUESTION, CASE_TARGET_ANSWER, CASE_TARGET_COMMENT}
CASE_ALLOWED_TARGETS = CASE_CONTENT_TARGETS | {CASE_TARGET_USER}

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


class RunConflictError(DomainError):
    """Agent 运行标识已存在，不能覆盖原有记录。"""

    http_status = 409


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


class CaseTransitionError(DomainError):
    """工单状态迁移不合法。"""

    http_status = 400


class CaseDecisionError(DomainError):
    """决策值或决策来源不在白名单内。"""

    http_status = 400


class CaseActionForbiddenError(DomainError):
    """调用方无权推进该状态（C-06：处置执行必须经管理员人工确认）。"""

    http_status = 403


class CaseTargetNotReadyError(DomainError):
    """处置探针未通过：目标不存在 / 已软删 / 已隐藏 / 已封禁，禁止写 executed。"""

    http_status = 409


class DecisionNotFoundError(DomainError):
    """Agent 决策未找到。"""

    http_status = 404


# ---------- 不变量与规则 ----------


AUDIT_SUMMARY_LIMIT = 200
_PRIVATE_KEY = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S,
)
_BEARER = re.compile(r"\bBearer\s+[^\s\"',;]+", re.I)
_AUDIT_SECRET = re.compile(
    r'''(["']?(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|'''
    r'''authorization|cookie|session[_-]?id|密码|口令|密钥|凭证)["']?\s*[=:：]\s*)'''
    r'''(?:"[^"]*"|'[^']*'|[^\s,;&]+)''', re.I,
)


def audit_summary(value: str | None) -> str | None:
    """先移除完整敏感块再压平/截断，不能把半截私钥保存为摘要。"""
    if value is None:
        return None
    masked = _PRIVATE_KEY.sub("[REDACTED_PRIVATE_KEY]", value)
    masked = _BEARER.sub("Bearer [REDACTED]", masked)
    masked = _AUDIT_SECRET.sub(r"\1[REDACTED]", masked)
    return " ".join(masked.split())[:AUDIT_SUMMARY_LIMIT]


def ensure_run_owner(owner_id: int | None, caller_id: int | None) -> None:
    """用户运行与旧服务运行相互隔离，未授权调用不暴露记录存在性。"""
    if owner_id != caller_id:
        raise RunNotFoundError()


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


# ---------- 工单状态机规则 ----------

def ensure_case_transition(current: str, target: str) -> None:
    """不变量：工单状态只能沿状态机迁移。"""
    if target not in ALLOWED_CASE_TRANSITIONS.get(current, set()):
        raise CaseTransitionError()


def ensure_decision_allowed(decision: str) -> None:
    """不变量：决策值必须在白名单内（resolve/warn/edit 本期一律 400）。"""
    if decision not in CASE_ALLOWED_DECISIONS:
        raise CaseDecisionError()


def ensure_decision_matches_target(decision: str, target_type: str) -> None:
    """不变量：处置动作与目标类型必须匹配——ban 仅对人，hide/delete 仅对内容。

    skip 为放弃语义，不操作目标，不参与匹配。
    """
    if decision == CASE_DECISION_SKIP:
        return
    if decision == CASE_DECISION_BAN:
        if target_type != CASE_TARGET_USER:
            raise CaseDecisionError("封禁动作只能作用于用户类工单")
    elif target_type not in CASE_CONTENT_TARGETS:
        raise CaseDecisionError("内容处置动作只能作用于问题 / 回答 / 评论类工单")
