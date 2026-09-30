# 问题与回答模型：课程内提问/解答（Markdown 正文、状态、软删除）
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Question(Base):
    """问题：归属课程，作者发布；软删除用 deleted_at 标记（E-10，行保留可追溯）。"""

    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 标题/正文上限由 qa/domain 截断保证（E-02），列宽与 TITLE_MAX_LEN 一致
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    course_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("courses.id"), nullable=False, index=True
    )
    author_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    # 状态：published / resolved（qa/domain 常量；采纳时迁移为 resolved）
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="published")
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 被采纳回答（US-06/E-05，T-05）：唯一约束保证一个问题最多一个采纳答案；
    # use_alter 标记与 answers.question_id 构成已知循环依赖（先建表后 ALTER）
    accepted_answer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("answers.id", use_alter=True), nullable=True, unique=True
    )
    # 软删除时间（非空即已删，普通列表与详情不可见，E-10）
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Answer(Base):
    """回答：归属问题，作者发布；推荐/认证为仅展示标记（E-13/D9，不影响采纳权）。"""

    __tablename__ = "answers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 正文上限由 qa/domain 截断保证（E-02，复用 BODY_MAX_LEN）
    body: Mapped[str] = mapped_column(Text, nullable=False)
    question_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("questions.id"), nullable=False, index=True
    )
    author_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    # 助教推荐标记（E-13：仅展示，不改问题状态与采纳权）
    recommended_by_assistant: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    # 教师优质内容认证（D9 定案：仅回答所在课程的负责教师可标记）
    certified_by_teacher: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    # 软删除时间（非空即已删，列表与采纳候选不可见，E-10）
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
