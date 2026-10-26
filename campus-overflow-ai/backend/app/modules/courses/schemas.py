"""courses 模块 Pydantic Schema：请求入参与响应出参（蛇形字段，2026-09-20 定案）。"""
from datetime import date, datetime

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


# ---------- 知识树（KN-R01） ----------


class KnowledgeNodesCreateRequest(BaseModel):
    """教师确认写入知识点（AI 建议确认与手动新增共用；E-17：仅经此口写入）。"""

    names: list[str] = Field(
        ..., min_length=1, max_length=50, description="知识点名称列表，1~50 个"
    )


class KnowledgeNodeResponse(BaseModel):
    """知识树节点（扁平表示；树形装配见 KnowledgeTreeResponse.tree）。"""

    id: int
    name: str
    sort_key: str
    parent_id: int | None = None
    position: str | None = None
    source: str
    created_at: datetime

    model_config = {"from_attributes": True}


class KnowledgeTreeNodeResponse(BaseModel):
    """知识树嵌套节点（前端渲染树形；children 递归）。"""

    id: int
    name: str
    sort_key: str
    position: str | None = None
    source: str
    children: "list[KnowledgeTreeNodeResponse]" = []


class KnowledgeTreeResponse(BaseModel):
    """课程知识树：扁平节点 + 嵌套树形 + BST 中序（sort_key 升序）知识点清单。"""

    course_id: int
    nodes: list[KnowledgeNodeResponse]
    tree: list[KnowledgeTreeNodeResponse]
    inorder: list[KnowledgeNodeResponse]


# ---------- 教学计划（KN-R03） ----------


class TeachingPlanCreateRequest(BaseModel):
    """教师新增教学计划条目：手动创建或从周报差距一键加入。"""

    title: str = Field(..., min_length=1, max_length=200, description="条目标题")
    detail: str | None = Field(None, max_length=2000, description="补充说明")
    report_id: int | None = Field(
        None, description="周报来源时传入；提供即标记为周报差距加入"
    )


class TeachingPlanUpdateRequest(BaseModel):
    """教师编辑教学计划条目：部分更新，None 表示不修改。"""

    title: str | None = Field(None, min_length=1, max_length=200)
    detail: str | None = Field(None, max_length=2000)
    status: str | None = Field(None, description="pending/done")


class TeachingPlanItemResponse(BaseModel):
    """教学计划条目。"""

    id: int
    course_id: int
    teacher_id: int
    title: str
    detail: str | None = None
    source: str
    report_id: int | None = None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------- 周报（KN-R02） ----------


class UncoveredTopicItem(BaseModel):
    """周报未覆盖主题（提问集中但知识树未覆盖，附拓宽建议）。"""

    topic: str = Field(..., min_length=1, max_length=100)
    question_count: int = Field(..., ge=1)
    suggestion: str = Field(..., min_length=1, max_length=500)


class HeatmapItem(BaseModel):
    """周报提问热力条目（知识点 → 提问量）。"""

    node_id: int = Field(..., ge=1)
    node_name: str = Field(..., min_length=1, max_length=100)
    question_count: int = Field(..., ge=0)


class WeeklyReportResponse(BaseModel):
    """教师周报（仅课程负责教师可见，E-14）。"""

    id: int
    course_id: int
    teacher_id: int
    week_start: date
    week_end: date
    content: str
    uncovered_topics: list[UncoveredTopicItem]
    heatmap: list[HeatmapItem]
    question_count: int
    agent_run_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class KnowledgeTreeCourseItem(BaseModel):
    """有知识树的课程条目（内部调度扫描用：E-19 无树课程不进清单）。"""

    course_id: int
    teacher_id: int
