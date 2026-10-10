# interaction 领域规则：投票 toggle 状态机、声誉积分表、领域异常
# 铁律：零框架依赖——本文件不得 import fastapi / sqlalchemy / pydantic，可直接单测。
from app.core.domain_error import DomainError

# ---------- 领域常量 ----------

# 投票目标类型（US-07：问题与回答都可投）
TARGET_QUESTION = "question"
TARGET_ANSWER = "answer"

# 投票方向（value 仅允许两值，E-04 唯一有效投票以行为单位）
VOTE_UP = 1
VOTE_DOWN = -1

# 积分规则（需求文档 4.7 表格字面）：采纳 +15、回答被点赞 +10、内容被点踩 -2；
# 问题被点赞不计分（表格只列"回答被点赞"），审查可调。
REPUTATION_ACCEPTED = 15
REPUTATION_ANSWER_UPVOTED = 10
REPUTATION_CONTENT_DOWNVOTED = -2

# 流水 reason：取消/改票同样写冲销流水（"积分变化必有流水"，不能静默回退）
REASON_ACCEPT = "accept"
REASON_ANSWER_UPVOTED = "answer_upvoted"
REASON_CONTENT_DOWNVOTED = "content_downvoted"
REASON_UPVOTE_CANCELLED = "upvote_cancelled"
REASON_DOWNVOTE_CANCELLED = "downvote_cancelled"

# 榜单（US-08/Q-04）：period 合法值；榜单条数上限（审查可调）
RANK_PERIOD_WEEK = "week"
RANK_PERIOD_MONTH = "month"
RANK_PERIOD_ALL = "all"
RANK_LIMIT = 10


# ---------- 领域异常（http_status 由 core/errors.py 统一映射） ----------


class NotificationNotFoundError(DomainError):
    """通知不存在。"""

    http_status = 404


class VoteTargetTypeError(DomainError):
    """投票目标类型非法（仅 question / answer）。"""

    http_status = 400


class VoteValueInvalidError(DomainError):
    """投票方向非法（仅 +1 / -1）。"""

    http_status = 400


class VoteTargetNotFoundError(DomainError):
    """投票目标不存在或已删除（软删内容不可投，E-10 同口径）。"""

    http_status = 404


class RankPeriodInvalidError(DomainError):
    """榜单周期非法（仅 week / month / all）。"""

    http_status = 400


# ---------- 领域规则 ----------


def ensure_vote_value(value: int) -> None:
    """投票方向仅 +1 / -1（E-04 入口防线，路由层 Pydantic 之外的双保险）。"""
    if value not in (VOTE_UP, VOTE_DOWN):
        raise VoteValueInvalidError()


def ensure_rank_period(period: str) -> None:
    """榜单周期合法性（接口文档 §6：非法 period → 400）。"""
    if period not in (RANK_PERIOD_WEEK, RANK_PERIOD_MONTH, RANK_PERIOD_ALL):
        raise RankPeriodInvalidError()


def is_visible(deleted_at: object | None) -> bool:
    """软删可见性（E-10 同口径）：deleted_at 非空即不可见。

    参数放宽为 object | None 以便零框架单测（qa 传 ORM 行属性，这里只判 None）。
    """
    return deleted_at is None


def next_vote_action(current: int | None, requested: int) -> str:
    """E-04 toggle 语义状态机：无票 → create；同向再点 → cancel（取消）；反向 → switch（改票）。

    接口文档 §6 定案："重复同方向 = 取消"。返回动作名，由 service 分派写入路径。
    """
    if current is None:
        return "create"
    if current == requested:
        return "cancel"
    return "switch"


def reputation_delta_for_vote(target_type: str, value: int) -> int:
    """投票对目标作者的声誉增量（需求文档 4.7 积分表）。

    回答被赞 +10；任何内容被踩 -2；问题被赞 0（表格字面，不计分不写流水）。
    """
    if value == VOTE_DOWN:
        return REPUTATION_CONTENT_DOWNVOTED
    if target_type == TARGET_ANSWER:
        return REPUTATION_ANSWER_UPVOTED
    return 0


def reputation_delta_for_cancel(target_type: str, value: int) -> int:
    """取消投票的冲销增量：恒为原增量取反（+10 取消 → -10，-2 取消 → +2）。"""
    return -reputation_delta_for_vote(target_type, value)


def cancel_reason_for(value: int) -> str:
    """取消投票对应的流水 reason（按被取消的票方向命名）。"""
    return REASON_UPVOTE_CANCELLED if value == VOTE_UP else REASON_DOWNVOTE_CANCELLED
