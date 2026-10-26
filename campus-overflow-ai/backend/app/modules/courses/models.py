# 课程模型：课程与课程成员（加入关系）
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Course(Base):
    """课程：由教师创建，创建者自动成为负责教师（teacher_id）。"""

    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    # 课程编码全局唯一（教师端接口文档 §1：编码重复 → 400）
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 学期标识：自由字符串（T-03 决策：plan 未定格式，精确匹配筛选）
    semester: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class CourseMember(Base):
    """课程成员：学生加入课程的记录（教师不在此表，负责人在 courses.teacher_id）。"""

    __tablename__ = "course_members"
    # 同一学生同一课程仅一条记录（重复加入 → 400，courses/domain.ensure_not_joined）
    __table_args__ = (UniqueConstraint("course_id", "user_id", name="uq_course_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class CourseKnowledgeNode(Base):
    """课程知识树节点（KN-R01）：知识点以二叉搜索树组织，sort_key 为排序键。

    parent_id 为空即树根；position 标记本节点是父节点的左/右子节点（根为空）。
    同课程 sort_key 唯一兜底重复插入（E-15，应用层由 domain 规则先行拒绝）。
    """

    __tablename__ = "course_knowledge_nodes"
    __table_args__ = (
        UniqueConstraint("course_id", "sort_key", name="uq_course_knowledge_sort_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # BST 排序键：名称去首尾空白（domain.normalize_sort_key）
    sort_key: Mapped[str] = mapped_column(String(100), nullable=False)
    parent_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("course_knowledge_nodes.id"), nullable=True
    )
    position: Mapped[str | None] = mapped_column(String(5), nullable=True)
    # 建树来源：teacher=大纲建树/手动新增（教师确认），report=周报差距拓宽（KN-R03）
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    created_by: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class TeachingPlanItem(Base):
    """教学计划条目（KN-R03）：教师的教学改进清单，支持手动与周报来源。

    report_id 为周报来源时的软引用（teacher_weekly_reports.id），
    不建外键以避免与周报表迁移顺序耦合（先例：agent_memory.course_id）。
    """

    __tablename__ = "teaching_plan_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id"), nullable=False, index=True
    )
    teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    # 来源：manual=手动创建，report=周报差距一键加入
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    report_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class TeacherWeeklyReport(Base):
    """教师周报（KN-R02）：系统每周自动生成的差距分析，归属课程负责教师。

    同课程同周唯一（E-18 幂等兜底）；uncovered_topics/heatmap 为结构化 JSON
    （由后端 schema 校验后入库，Agent 只提交、不绕过校验）。
    """

    __tablename__ = "teacher_weekly_reports"
    __table_args__ = (
        UniqueConstraint("course_id", "week_start", name="uq_weekly_report_course_week"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id"), nullable=False, index=True
    )
    # 保存时负责教师快照（课程转让后旧周报仍归属生成时的教师）
    teacher_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    week_end: Mapped[date] = mapped_column(Date, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    uncovered_topics: Mapped[list] = mapped_column(JSON, nullable=False)
    heatmap: Mapped[list] = mapped_column(JSON, nullable=False)
    question_count: Mapped[int] = mapped_column(Integer, nullable=False)
    agent_run_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
