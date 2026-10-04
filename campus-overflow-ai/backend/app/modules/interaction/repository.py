# interaction 数据访问：投票、声誉流水的查询与写入（唯一允许 import models 的文件）
# 事务约定 D-8：只 flush 不 commit，事务边界在 service。
from datetime import datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.modules.interaction.models import AnswerVote, Notification, QuestionVote, ReputationLog
from app.modules.interaction.schemas import NotificationItem, RankCandidateData, ReputationLogData


def _vote_model(target_type: str) -> tuple[type[QuestionVote] | type[AnswerVote], sa.Column]:
    """按目标类型取投票表与目标列（question_votes / answer_votes 二选一）。"""
    if target_type == "question":
        return QuestionVote, QuestionVote.question_id
    return AnswerVote, AnswerVote.answer_id


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


def lock_vote_value(
    db: Session, target_type: str, target_id: int, user_id: int
) -> int | None:
    model, column = _vote_model(target_type)
    row = db.query(model.value).filter(
        column == target_id, model.user_id == user_id
    ).with_for_update().first()
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
) -> tuple[list[ReputationLogData], int]:
    """分页取本人流水（E-11：调用方须以当前用户 id 过滤），创建时间倒序。"""
    query = db.query(ReputationLog).filter(ReputationLog.user_id == user_id)
    total = query.count()
    logs = (
        query.order_by(ReputationLog.created_at.desc(), ReputationLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [
        ReputationLogData(
            delta=log.delta, reason=log.reason, ref_type=log.ref_type,
            ref_id=log.ref_id, created_at=log.created_at,
        )
        for log in logs
    ], total


def list_rank_candidate_batch(
    db: Session, period: str, course_id: int | None,
    last_score: int | None, last_user_id: int | None, as_of: datetime, limit: int = 100,
) -> list[RankCandidateData]:
    """聚合后按分数降序、用户 id 升序游标分页，每批最多 100 个候选。"""
    query = db.query(
        ReputationLog.user_id,
        sa.func.sum(ReputationLog.delta).label("score"),
    )
    if course_id is not None:
        query = query.filter(ReputationLog.course_id == course_id)
    window_days = {"week": 7, "month": 30}.get(period)
    if window_days is not None:
        query = query.filter(
            ReputationLog.created_at >= as_of - timedelta(days=window_days)
        )
    aggregated = query.group_by(ReputationLog.user_id).subquery()
    candidates = db.query(aggregated.c.user_id, aggregated.c.score)
    if last_score is not None and last_user_id is not None:
        candidates = candidates.filter(sa.or_(
            aggregated.c.score < last_score,
            sa.and_(aggregated.c.score == last_score, aggregated.c.user_id > last_user_id),
        ))
    rows = (
        candidates.order_by(aggregated.c.score.desc(), aggregated.c.user_id.asc())
        .limit(max(1, min(limit, 100)))
        .all()
    )
    return [RankCandidateData(user_id=user_id, score=score) for user_id, score in rows]


def create_notification(
    db: Session, recipient_id: int, notification_type: str, title: str, link: str,
) -> None:
    db.add(Notification(recipient_id=recipient_id, type=notification_type, title=title, link=link))
    db.flush()


def list_notifications(
    db: Session, recipient_id: int, unread_only: bool, page: int, page_size: int,
) -> tuple[list[NotificationItem], int, int]:
    query = db.query(Notification).filter(Notification.recipient_id == recipient_id)
    unread_count = query.filter(Notification.is_read.is_(False)).count()
    if unread_only:
        query = query.filter(Notification.is_read.is_(False))
    total = query.count()
    rows = query.order_by(Notification.created_at.desc(), Notification.id.desc()).offset(
        (page - 1) * page_size
    ).limit(page_size).all()
    return [NotificationItem.model_validate(row) for row in rows], total, unread_count


def mark_notification_read(db: Session, recipient_id: int, notification_id: int) -> bool:
    query = db.query(Notification).filter(
        Notification.id == notification_id, Notification.recipient_id == recipient_id
    )
    updated = query.filter(Notification.is_read.is_(False)).update(
        {Notification.is_read: True}, synchronize_session=False
    )
    db.flush()
    return updated > 0 or query.first() is not None


def mark_all_notifications_read(db: Session, recipient_id: int) -> None:
    db.query(Notification).filter(
        Notification.recipient_id == recipient_id, Notification.is_read.is_(False)
    ).update({Notification.is_read: True}, synchronize_session=False)
    db.flush()
