"""qa 模块 Pydantic Schema：请求入参与响应出参（蛇形字段）。

标签绑定归 T-07：本期不收 tagIds，列表/详情 tags 返回空数组；
vote_score / my_vote 依赖 T-08，本期返回 0 占位；
answer_count / has_accepted / accepted_answer_id 已随 T-05 回填真实值。
"""
from datetime import datetime

from pydantic import BaseModel, Field

# ---------- 请求 Schema ----------


class QuestionCreateRequest(BaseModel):
    """发布问题请求（学生端接口文档 §3）。上限截断由 qa/domain 承担（E-02）。"""

    title: str = Field(..., min_length=1, description="标题，超长截断至 100 字")
    body: str = Field(..., min_length=1, description="Markdown 正文，入库前清洗（X-03）")
    course_id: int = Field(..., description="已加入的课程")


class QuestionUpdateRequest(BaseModel):
    """编辑问题请求：部分更新，None 表示不修改。"""

    title: str | None = Field(None, min_length=1, description="标题")
    body: str | None = Field(None, min_length=1, description="Markdown 正文")


class AnswerCreateRequest(BaseModel):
    """发布回答请求（学生端接口文档 §4）：正文必填，清洗截断由 qa/domain 承担。"""

    body: str = Field(..., min_length=1, description="Markdown 正文，入库前清洗（X-03）")


class AnswerUpdateRequest(BaseModel):
    """编辑回答请求：body None 表示不修改。"""

    body: str | None = Field(None, min_length=1, description="Markdown 正文")


class RecommendRequest(BaseModel):
    """助教推荐标记请求（E-13）：true 标记 / false 取消。"""

    recommended: bool = Field(..., description="true 标记 / false 取消")


class CommentCreateRequest(BaseModel):
    """发表评论请求（学生端接口文档 §5）：parent_id 给定时为二级回复。"""

    body: str = Field(..., min_length=1, description="评论内容，入库前清洗（X-03）")
    parent_id: int | None = Field(None, description="父评论 id，给定时为二级回复")


# ---------- 响应 Schema ----------


class QuestionResponse(BaseModel):
    """问题完整信息（模块内部表示，author 用户名由 service 跨模块补充）。"""

    id: int
    title: str
    body: str
    course_id: int
    author_id: int
    status: str
    view_count: int
    accepted_answer_id: int | None = None
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class QuestionListItemResponse(BaseModel):
    """问题列表条目（学生端接口文档 §3）。answer_count/has_accepted 由 service 回填。"""

    id: int
    title: str
    course_id: int
    author: str
    tags: list = []
    status: str
    vote_score: int = 0  # T-08 回填
    answer_count: int
    view_count: int
    has_accepted: bool
    created_at: datetime


class QuestionDetailResponse(BaseModel):
    """问题详情（学生端接口文档 §3）：body 为已清洗文本。"""

    id: int
    title: str
    body: str
    course_id: int
    author: str
    tags: list = []
    status: str
    vote_score: int = 0  # T-08 回填
    my_vote: int = 0  # T-08 回填
    accepted_answer_id: int | None
    view_count: int
    created_at: datetime
    updated_at: datetime


class AnswerResponse(BaseModel):
    """回答完整信息（模块内部表示，author 用户名由 service 跨模块补充）。"""

    id: int
    body: str
    question_id: int
    author_id: int
    recommended_by_assistant: bool
    certified_by_teacher: bool
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AnswerListItemResponse(BaseModel):
    """回答列表条目（学生端接口文档 §4）：is_accepted 由提问采纳关系判定。"""

    id: int
    author: str
    body: str
    vote_score: int = 0  # T-08 回填
    my_vote: int = 0  # T-08 回填
    is_accepted: bool
    recommended_by_assistant: bool
    certified_by_teacher: bool
    created_at: datetime


class CommentResponse(BaseModel):
    """评论完整信息（模块内部表示，author 用户名由 service 跨模块补充）。"""

    id: int
    body: str
    question_id: int | None
    answer_id: int | None
    author_id: int
    parent_id: int | None
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CommentReplyResponse(BaseModel):
    """二级回复条目（挂 replies 数组内，二级限制下无下级）。"""

    id: int
    author: str
    body: str
    parent_id: int
    created_at: datetime


class CommentListItemResponse(BaseModel):
    """评论列表条目（学生端接口文档 §5）：顶级评论分页，二级回复归组 replies。"""

    id: int
    author: str
    body: str
    created_at: datetime
    replies: list[CommentReplyResponse] = []
