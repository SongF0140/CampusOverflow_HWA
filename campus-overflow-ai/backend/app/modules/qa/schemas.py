"""qa 模块 Pydantic Schema：请求入参与响应出参（蛇形字段）。

标签绑定归 T-07：本期不收 tagIds，列表/详情 tags 返回空数组；
vote_score / answer_count / has_accepted / accepted_answer_id / my_vote
依赖 T-05/T-08，本期返回 0 / False / None 占位。
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
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class QuestionListItemResponse(BaseModel):
    """问题列表条目（学生端接口文档 §3）。"""

    id: int
    title: str
    course_id: int
    author: str
    tags: list = []
    status: str
    vote_score: int = 0  # T-08 回填
    answer_count: int = 0  # T-05 回填
    view_count: int
    has_accepted: bool = False  # T-05 回填
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
    accepted_answer_id: int | None = None  # T-05 回填
    view_count: int
    created_at: datetime
    updated_at: datetime
