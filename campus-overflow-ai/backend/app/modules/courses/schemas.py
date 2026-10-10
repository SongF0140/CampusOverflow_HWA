"""courses 模块 Pydantic Schema：请求入参与响应出参（蛇形字段，2026-09-20 定案）。"""
from datetime import datetime

from pydantic import BaseModel, Field

# ---------- 请求 Schema ----------


class CourseCreateRequest(BaseModel):
    """教师创建课程请求（教师端接口文档 §1）。"""

    name: str = Field(..., min_length=1, max_length=50, description="课程名，≤ 50 字")
    code: str = Field(..., min_length=1, max_length=50, description="课程编码，全局唯一")
    description: str | None = Field(None, max_length=500, description="课程简介")
    semester: str | None = Field(None, max_length=20, description="学期标识")


class CourseUpdateRequest(BaseModel):
    """教师编辑课程请求：部分更新，None 表示不修改该字段。"""

    name: str | None = Field(None, min_length=1, max_length=50, description="课程名")
    description: str | None = Field(None, max_length=500, description="课程简介")
    semester: str | None = Field(None, max_length=20, description="学期标识")


# ---------- 响应 Schema ----------


class CourseResponse(BaseModel):
    """课程完整信息（模块内部表示，teacher_name 由 service 跨模块补充）。"""

    id: int
    name: str
    code: str
    description: str | None = None
    semester: str | None = None
    teacher_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CourseListItemResponse(BaseModel):
    """课程列表条目（学生端接口文档 §2）。"""

    id: int
    name: str
    code: str
    teacher_name: str
    member_count: int
    # T-03 时 qa 模块未落地，先返回 0；T-04 落地后由 qa 侧统计回填
    question_count: int = 0
    # 当前用户是否已加入（列表页前端可直接判加入状态，前端缺口第 4 条）
    joined: bool = False
    created_at: datetime


class CourseAggregatesResponse(BaseModel):
    """课程页四聚合区块（学生端接口文档 §2：无数据时返回空数组）。

    全部依赖 qa/interaction 模块：hot_questions/frequent_questions 随 T-04/T-09、
    tags 随 T-07、active_users 随 T-08 回填；courses 不反向依赖 qa（避免循环依赖）。
    """

    hot_questions: list = []
    tags: list = []
    active_users: list = []
    frequent_questions: list = []


class CourseDetailResponse(BaseModel):
    """课程详情（学生端接口文档 §2）：joined 为当前用户加入状态。

    is_owner / can_post 供前端判定发布资格：can_post 与 qa 发布资格
    （负责教师或已加入）保持一致，避免前端显示可发而后端 403。
    """

    id: int
    name: str
    code: str
    description: str | None = None
    semester: str | None = None
    teacher_name: str
    joined: bool
    is_owner: bool = False
    can_post: bool = False
    aggregates: CourseAggregatesResponse
    created_at: datetime


class MemberItemResponse(BaseModel):
    """课程成员列表条目（教师端接口文档 §1）。"""

    user_id: int
    username: str
    joined_at: datetime
