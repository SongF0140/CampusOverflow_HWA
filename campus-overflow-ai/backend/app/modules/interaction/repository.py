# interaction 数据访问：投票、声誉流水的查询与写入（唯一允许 import models 的文件）
# 事务约定 D-8：只 flush 不 commit，事务边界在 service。
from datetime import datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.modules.interaction.models import AnswerVote, QuestionVote, ReputationLog
from app.modules.qa.models import Answer, Question


def _vote_model(target_type: str) -> tuple[type[QuestionVote] | type[AnswerVote], sa.Column]:
    """按目标类型取投票表与目标列（question_votes / answer_votes 二选一）。"""
    if target_type == "question":
        return QuestionVote, QuestionVote.question_id
    return AnswerVote, AnswerVote.answer_id


def get_vote_target(db: Session, target_type: str, target_id: int):
    """取投票目标行（questions / answers），软删判断由 service 用 domain.is_visible 完成。"""
    if target_type == "question":
        return db.query(Question).filter(Question.id == target_id).first()
    return db.query(Answer).filter(Answer.id == target_id).first()


def get_question_course_id(db: Session, question_id: int) -> int | None:
    """取问题所属课程（回答投票的流水课程快照用）。"""
    row = (
        db.query(Question.course_id).filter(Question.id == question_id).first()
    )
    return row[0] if row else None


def get_vote_value(
    db: Session, target_type: str, target_id: int, user_id: int
) -> int | None:
    """当前用户对目标的有效票向；无票返回 None（E-04：一人最多一行）。"""
    model, column = _vote_model(target_type)
    row = (
        db.query(model.value)
        .filter(column == target_id, model.user_id == user_id)
        .first()
    )
    return row[0] if row else None


def get_my_vote_map(
    db: Session, user_id: int, target_type: str, target_ids: list[int]
) -> dict[int, int]:
    """批量取当前用户的票向映射（qa 列表回填 my_vote，防 N+1）。"""
    model, column = _vote_model(target_type)
    rows = (
        db.query(column, model.value)
        .filter(column.in_(target_ids), model.user_id == user_id)
        .all()
    )
    return {row[0]: row[1] for row in rows}


def create_vote(
    db: Session, target_type: str, target_id: int, user_id: int, value: int
) -> None:
    """新增投票行（E-04 并发重复由 uq_*_votes_pair 唯一约束兜底）。"""
    model, column = _vote_model(target_type)
    db.add(model(**{column.key: target_id, "user_id": user_id, "value": value}))
    db.flush()


def update_vote(
    db: Session, target_type: str, target_id: int, user_id: int, value: int
) -> None:
    """改票：原地更新票向（行不变，仅 value/updated_at 变）。"""
    model, column = _vote_model(target_type)
    db.query(model).filter(column == target_id, model.user_id == user_id).update(
        {"value": value}, synchronize_session=False
    )
    db.flush()


def delete_vote(db: Session, target_type: str, target_id: int, user_id: int) -> None:
    """取消投票：删行（有效票状态由行存在性表达）。"""
    model, column = _vote_model(target_type)
    db.query(model).filter(column == target_id, model.user_id == user_id).delete(
        synchronize_session=False
    )
    db.flush()


def adjust_vote_score(db: Session, target_type: str, target_id: int, delta: int) -> None:
    """维护目标 vote_score 快照（与投票写入同事务，service 统一 commit）。"""
    if target_type == "question":
        db.query(Question).filter(Question.id == target_id).update(
            {"vote_score": Question.vote_score + delta}, synchronize_session=False
        )
    else:
        db.query(Answer).filter(Answer.id == target_id).update(
            {"vote_score": Answer.vote_score + delta}, synchronize_session=False
        )
    db.flush()


def get_vote_score(db: Session, target_type: str, target_id: int) -> int:
    """读取目标最新投票分（回包用）。"""
    if target_type == "question":
        row = db.query(Question.vote_score).filter(Question.id == target_id).first()
    else:
        row = db.query(Answer.vote_score).filter(Answer.id == target_id).first()
    return row[0] if row else 0


def create_reputation_log(
    db: Session, user_id: int, delta: int, reason: str, ref_type: str, ref_id: int,
    course_id: int | None = None,
) -> None:
    """写声誉流水（需求文档 4.7：积分变化必有流水，不能只改总分）。"""
    db.add(
        ReputationLog(
            user_id=user_id, delta=delta, reason=reason,
            ref_type=ref_type, ref_id=ref_id, course_id=course_id,
        )
    )
    db.flush()


def list_reputation_logs(
    db: Session, user_id: int, page: int, page_size: int
) -> tuple[list[ReputationLog], int]:
    """分页取本人流水（E-11：调用方须以当前用户 id 过滤），创建时间倒序。"""
    query = db.query(ReputationLog).filter(ReputationLog.user_id == user_id)
    total = query.count()
    logs = (
        query.order_by(ReputationLog.created_at.desc(), ReputationLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return logs, total


def get_public_content_counts(db: Session, user_id: int) -> dict[str, int]:
    """用户公开可见内容数（软删不计，E-10）；公开声誉接口（§2）用。"""
    question_count = (
        db.query(sa.func.count(Question.id))
        .filter(Question.author_id == user_id, Question.deleted_at.is_(None))
        .scalar()
    )
    answer_count = (
        db.query(sa.func.count(Answer.id))
        .filter(Answer.author_id == user_id, Answer.deleted_at.is_(None))
        .scalar()
    )
    return {"question_count": question_count or 0, "answer_count": answer_count or 0}


def list_rank(
    db: Session, period: str, course_id: int | None
) -> list[tuple[int, int]]:
    """聚合窗口或课程流水；先保留全部候选，供 service 排除缺失用户后截取榜单。"""
    query = db.query(
        ReputationLog.user_id,
        sa.func.sum(ReputationLog.delta).label("score"),
    )
    if course_id is not None:
        query = query.filter(ReputationLog.course_id == course_id)
    window_days = {"week": 7, "month": 30}.get(period)
    if window_days is not None:
        query = query.filter(
            ReputationLog.created_at >= datetime.now() - timedelta(days=window_days)
        )
    rows = (
        query.group_by(ReputationLog.user_id)
        .order_by(sa.desc("score"), ReputationLog.user_id.asc())
        .all()
    )
    return [(user_id, score) for user_id, score in rows]
