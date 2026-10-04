# interaction Schema：投票请求/回包、声誉流水与榜单（字段蛇形，接口文档 §2/§6）
from datetime import datetime

from pydantic import BaseModel, Field


class VoteCreateRequest(BaseModel):
    """投票入参（US-07）：value 仅 ±1、target_type 仅 question/answer，
    由 interaction/domain 兜底校验（非法 400，中文提示）。"""

    target_type: str
    target_id: int = Field(ge=1)
    value: int


class VoteResultResponse(BaseModel):
    """投票回包：目标最新投票分 + 当前用户票向（取消后 my_vote=0）。"""

    target_type: str
    target_id: int
    vote_score: int
    my_vote: int


class ReputationLogData(BaseModel):
    delta: int
    reason: str
    ref_type: str
    ref_id: int
    created_at: datetime


class ReputationLogItem(BaseModel):
    """积分流水条目（需求文档 4.7：积分变化必有流水）。"""

    delta: int
    reason: str
    ref_type: str
    ref_id: int
    created_at: datetime


class ReputationMeResponse(BaseModel):
    """我的积分与流水（E-11：流水仅本人可见）。"""

    score: int
    logs: list[ReputationLogItem]
    total: int
    page: int
    page_size: int


class PublicReputationResponse(BaseModel):
    """用户公开声誉（接口文档 §2：不含流水，E-11）。"""

    user_id: int
    username: str
    reputation_score: int
    question_count: int
    answer_count: int


class RankCandidateData(BaseModel):
    user_id: int
    score: int


class RankItem(BaseModel):
    """榜单条目（US-08）。"""

    user_id: int
    username: str
    score: int


class RankResponse(BaseModel):
    """积分榜单回包（Q-04：内存实现，无 Redis）。"""

    items: list[RankItem]


class NotificationItem(BaseModel):
    id: int
    type: str
    title: str
    link: str
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationsResponse(BaseModel):
    items: list[NotificationItem]
    total: int
    unread_count: int
    page: int
    page_size: int
