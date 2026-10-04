# interaction 业务层：投票 toggle、声誉写入（跨模块复用点）、声誉查询与榜单
# 分层基线 D-1/D-2/D-3/D-7/D-8 同 qa：本层不碰 ORM models，不碰 HTTP 协议，写用例末尾显式 commit。
from datetime import datetime

from sqlalchemy.orm import Session

from app.modules.identity import service as identity_service
from app.modules.interaction import domain, repository
from app.modules.interaction.schemas import (
    NotificationsResponse,
    PublicReputationResponse,
    RankItem,
    RankResponse,
    ReputationLogItem,
    ReputationMeResponse,
    VoteResultResponse,
)
from app.modules.qa import domain as qa_domain
from app.modules.qa import service as qa_service
from app.modules.qa.schemas import (
    AnswerListItemResponse,
    AnswerResponse,
    CommentResponse,
    QuestionDetailResponse,
    QuestionListItemResponse,
    VoteTargetData,
    normalize_created_range,
)


def list_questions(
    db: Session, page: int, page_size: int, course_id: int | None,
    sort: str, unresolved: bool, keyword: str | None, viewer_id: int,
    tag_id: int | None = None,
    created_from: datetime | None = None, created_before: datetime | None = None,
) -> tuple[list[QuestionListItemResponse], int]:
    created_from, created_before = normalize_created_range(created_from, created_before)
    items, total = qa_service.list_questions(
        db, page, page_size, course_id, sort, unresolved, keyword, tag_id,
        created_from, created_before,
    )
    votes = get_my_vote_map(db, viewer_id, domain.TARGET_QUESTION, [item.id for item in items])
    for item in items:
        item.my_vote = votes.get(item.id, 0)
    return items, total


def get_question_detail(
    db: Session, question_id: int, viewer_id: int
) -> QuestionDetailResponse:
    question = qa_service.get_question_detail(db, question_id)
    votes = get_my_vote_map(db, viewer_id, domain.TARGET_QUESTION, [question.id])
    question.my_vote = votes.get(question.id, 0)
    db.commit()
    return question


def list_answers(
    db: Session, question_id: int, sort: str, page: int, page_size: int, viewer_id: int
) -> tuple[list[AnswerListItemResponse], int]:
    items, total = qa_service.list_answers(db, question_id, sort, page, page_size)
    votes = get_my_vote_map(db, viewer_id, domain.TARGET_ANSWER, [item.id for item in items])
    for item in items:
        item.my_vote = votes.get(item.id, 0)
    return items, total


def notify(
    db: Session, actor_id: int, recipient_ids: list[int | None],
    notification_type: str, title: str, link: str,
) -> None:
    for recipient_id in sorted(set(recipient_ids) - {None, actor_id}):
        repository.create_notification(db, recipient_id, notification_type, title, link)


def publish_answer(
    db: Session, user_id: int, question_id: int, body: str,
) -> tuple[AnswerResponse, bool]:
    try:
        prepared = qa_service.prepare_answer(db, user_id, question_id, body)
        notify(
            db, user_id, [prepared.question_author_id], "answered", "你的问题收到新回答",
            f"/questions/{question_id}#answer-{prepared.answer.id}",
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return prepared.answer, prepared.truncated


def publish_comment(
    db: Session, user_id: int, target: str, target_id: int, body: str,
    parent_id: int | None,
) -> tuple[CommentResponse, bool]:
    try:
        prepared = qa_service.prepare_comment(db, user_id, target, target_id, body, parent_id)
        notify(
            db, user_id, [prepared.target_author_id, prepared.parent_author_id],
            "commented", "你的内容收到新评论",
            f"/questions/{prepared.question_id}#comment-{prepared.comment.id}",
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return prepared.comment, prepared.truncated


def list_notifications(
    db: Session, user_id: int, unread_only: bool, page: int, page_size: int,
) -> NotificationsResponse:
    items, total, unread_count = repository.list_notifications(
        db, user_id, unread_only, page, page_size,
    )
    return NotificationsResponse(
        items=items, total=total, unread_count=unread_count, page=page, page_size=page_size,
    )


def read_notification(db: Session, user_id: int, notification_id: int) -> int:
    """单条已读（幂等）：不存在或非本人 404；返回本人全部未读数（接口文档 §8）。"""
    try:
        if not repository.mark_notification_read(db, user_id, notification_id):
            raise domain.NotificationNotFoundError()
        _, _, unread_count = repository.list_notifications(db, user_id, True, 1, 1)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return unread_count


def read_all_notifications(db: Session, user_id: int) -> int:
    """全部已读（幂等）：仅标本人未读；返回本人全部未读数（接口文档 §8）。"""
    try:
        repository.mark_all_notifications_read(db, user_id)
        _, _, unread_count = repository.list_notifications(db, user_id, True, 1, 1)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return unread_count


def accept_answer(db: Session, user_id: int, answer_id: int) -> dict:
    try:
        accepted = qa_service.prepare_answer_acceptance(db, user_id, answer_id)
        grant_reputation(
            db,
            user_id=accepted.author_id,
            delta=domain.REPUTATION_ACCEPTED,
            reason=domain.REASON_ACCEPT,
            ref_type=domain.TARGET_ANSWER,
            ref_id=accepted.answer_id,
            course_id=accepted.course_id,
        )
        notify(db, user_id, [accepted.author_id], "accepted", "你的回答已被采纳",
               f"/questions/{accepted.question_id}#answer-{accepted.answer_id}")
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"accepted": True, "question_status": qa_domain.STATUS_RESOLVED}


def vote(
    db: Session, user_id: int, target_type: str, target_id: int, value: int
) -> VoteResultResponse:
    """投票（US-07/E-04 toggle 语义）：create/cancel/switch 三分支，同一事务内
    维护目标 vote_score 快照与作者声誉（需求文档 4.7），末尾统一 commit（D-8）。
    """
    domain.ensure_vote_value(value)
    if target_type not in (domain.TARGET_QUESTION, domain.TARGET_ANSWER):
        raise domain.VoteTargetTypeError()
    try:
        target = qa_service.lock_vote_target(db, target_type, target_id)
        if target is None or not domain.is_visible(target.deleted_at):
            raise domain.VoteTargetNotFoundError()
        current = repository.lock_vote_value(db, target_type, target_id, user_id)
        action = domain.next_vote_action(current, value)
        if action == "cancel":
            repository.delete_vote(db, target_type, target_id, user_id)
            qa_service.adjust_vote_score(db, target_type, target_id, -value)
            _apply_author_reputation_on_cancel(db, target, target_type, value)
        elif action == "switch":
            repository.update_vote(db, target_type, target_id, user_id, value)
            qa_service.adjust_vote_score(db, target_type, target_id, 2 * value)
            _apply_author_reputation_on_cancel(db, target, target_type, current)
            _apply_author_reputation_on_vote(db, target, target_type, value)
        else:
            repository.create_vote(db, target_type, target_id, user_id, value)
            qa_service.adjust_vote_score(db, target_type, target_id, value)
            _apply_author_reputation_on_vote(db, target, target_type, value)
        vote_score = qa_service.get_vote_score(db, target_type, target_id)
        my_vote = repository.get_vote_value(db, target_type, target_id, user_id) or 0
        db.commit()
    except Exception:
        db.rollback()
        raise
    return VoteResultResponse(
        target_type=target_type, target_id=target_id, vote_score=vote_score, my_vote=my_vote
    )


def _apply_author_reputation_on_vote(
    db: Session, target: VoteTargetData, target_type: str, value: int
) -> None:
    """投票生效时的作者声誉（积分表：问题赞 0 不计分不写流水）。"""
    delta = domain.reputation_delta_for_vote(target_type, value)
    if delta == 0:
        return
    reason = (
        domain.REASON_ANSWER_UPVOTED if delta > 0 else domain.REASON_CONTENT_DOWNVOTED
    )
    grant_reputation(
        db,
        user_id=target.author_id,
        delta=delta,
        reason=reason,
        ref_type=target_type,
        ref_id=target.id,
        course_id=target.course_id,
    )


def _apply_author_reputation_on_cancel(
    db: Session, target: VoteTargetData, target_type: str, cancelled_value: int
) -> None:
    """取消/改票时对旧票冲销（恒为原增量取反，写冲销流水）。"""
    delta = domain.reputation_delta_for_cancel(target_type, cancelled_value)
    if delta == 0:
        return
    grant_reputation(
        db,
        user_id=target.author_id,
        delta=delta,
        reason=domain.cancel_reason_for(cancelled_value),
        ref_type=target_type,
        ref_id=target.id,
        course_id=target.course_id,
    )


def grant_reputation(
    db: Session, user_id: int, delta: int, reason: str, ref_type: str, ref_id: int,
    course_id: int | None = None,
) -> None:
    """声誉写入唯一入口（架构说明 4.B/需求 4.7）：总分与流水同事务，flush 不 commit（D-8）。

    供本模块 vote 与 accept_answer（采纳 +15）复用；调用方负责事务提交。
    """
    identity_service.adjust_user_reputation(db, user_id, delta)
    repository.create_reputation_log(
        db, user_id=user_id, delta=delta, reason=reason,
        ref_type=ref_type, ref_id=ref_id, course_id=course_id,
    )


def my_reputation(
    db: Session, user_id: int, page: int, page_size: int
) -> ReputationMeResponse:
    """我的积分与流水（US-08/E-11：流水仅本人可见）。"""
    score = identity_service.get_by_id(db, user_id).reputation_score
    logs, total = repository.list_reputation_logs(db, user_id, page, page_size)
    items = [
        ReputationLogItem(
            delta=log.delta, reason=log.reason, ref_type=log.ref_type,
            ref_id=log.ref_id, created_at=log.created_at,
        )
        for log in logs
    ]
    return ReputationMeResponse(
        score=score, logs=items, total=total, page=page, page_size=page_size
    )


def public_reputation(db: Session, user_id: int) -> PublicReputationResponse:
    """用户公开声誉（接口文档 §2：不含流水，E-11；用户不存在 → 404）。"""
    user = identity_service.get_public(db, user_id)
    counts = qa_service.get_public_content_counts(db, user_id)
    return PublicReputationResponse(
        user_id=user.id,
        username=user.username,
        reputation_score=user.reputation_score,
        question_count=counts.question_count,
        answer_count=counts.answer_count,
    )


def rank(db: Session, period: str, course_id: int | None) -> RankResponse:
    """积分榜单（US-08/Q-04 无 Redis）：all 用总分列，week/month 聚合窗口内流水；
    course 按流水课程快照过滤。非法 period → 400（domain）。
    """
    domain.ensure_rank_period(period)
    if period == "all" and course_id is None:
        entries = identity_service.list_reputation_rank(db, domain.RANK_LIMIT)
        items = [
            RankItem(user_id=entry.user_id, username=entry.username, score=entry.score)
            for entry in entries
        ]
    else:
        items = []
        as_of = datetime.now()
        last_score = last_user_id = None
        while len(items) < domain.RANK_LIMIT:
            candidates = repository.list_rank_candidate_batch(
                db, period, course_id, last_score, last_user_id, as_of
            )
            if not candidates:
                break
            usernames = identity_service.get_usernames_by_ids(
                db, [candidate.user_id for candidate in candidates]
            )
            for candidate in candidates:
                if candidate.user_id in usernames:
                    items.append(RankItem(
                        user_id=candidate.user_id, username=usernames[candidate.user_id],
                        score=candidate.score,
                    ))
                    if len(items) == domain.RANK_LIMIT:
                        break
            last_score, last_user_id = candidates[-1].score, candidates[-1].user_id
            if len(candidates) < 100:
                break
    return RankResponse(items=items)


def get_my_vote_map(
    db: Session, user_id: int, target_type: str, target_ids: list[int]
) -> dict[int, int]:
    """批量取当前用户投票方向（qa 列表/详情回填 my_vote，防 N+1；跨模块公开函数 D-5）。"""
    if not target_ids:
        return {}
    return repository.get_my_vote_map(db, user_id, target_type, target_ids)
