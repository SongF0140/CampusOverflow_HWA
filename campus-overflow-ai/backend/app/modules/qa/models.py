# 问题模型：课程内提问（Markdown 正文、状态、软删除）
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
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
    # 状态：published / resolved（qa/domain 常量；采纳迁移随 T-05）
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="published")
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 软删除时间（非空即已删，普通列表与详情不可见，E-10）
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
