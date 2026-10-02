# interaction 模型：投票（问题/回答各一张，库层唯一约束兜底 E-04）与声誉流水
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class QuestionVote(Base):
    """问题投票（US-07）：一人一票（E-04），取消投票=删行，改票=原地改 value。

    拆表而非单表双可空列：MySQL 唯一约束不拦截含 NULL 的行，
    拆表后 (question_id, user_id) 均非空，uq 约束真实防并发重复投票。
    """

    __tablename__ = "question_votes"
    __table_args__ = (
        UniqueConstraint("question_id", "user_id", name="uq_question_votes_pair"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("questions.id"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    # 投票方向：+1 赞 / -1 踩（interaction/domain 常量）
    value: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AnswerVote(Base):
    """回答投票（US-07）：与 QuestionVote 同构，约束名独立。"""

    __tablename__ = "answer_votes"
    __table_args__ = (
        UniqueConstraint("answer_id", "user_id", name="uq_answer_votes_pair"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    answer_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("answers.id"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    value: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ReputationLog(Base):
    """声誉流水（需求文档 4.7：积分变化必须有流水，不能只改总分）。

    用户总分为 users.reputation_score（identity 侧列），本表是对账明细；
    course_id 为写入时快照（采纳/投票时解析目标所属课程），支撑课程榜免跨模块 join。
    """

    __tablename__ = "reputation_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    # 增量：+15 采纳 / +10 回答被赞 / -2 被踩 / 取消冲销为相反数（domain 积分表）
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    # reason：accept / answer_upvoted / content_downvoted / upvote_cancelled / downvote_cancelled
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    # 关联对象：question / answer + 对应 id（ref_type 非外键，跨表多态引用）
    ref_type: Mapped[str] = mapped_column(String(20), nullable=False)
    ref_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # 课程快照（可空：理论上投票目标必有课程，兜底 NULL 不进课程榜）
    course_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("courses.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
