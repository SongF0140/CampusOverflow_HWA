# interaction 业务层：投票 toggle、声誉写入（跨模块复用点）、声誉查询与榜单
# 分层基线 D-1/D-2/D-3/D-7/D-8 同 qa：本层不碰 ORM models，不碰 HTTP 协议，写用例末尾显式 commit。
from sqlalchemy.orm import Session

from app.modules.identity import service as identity_service
from app.modules.interaction import domain, repository
from app.modules.interaction.schemas import (
    PublicReputationResponse,
    RankItem,
    RankResponse,
    ReputationLogItem,
    ReputationMeResponse,
    VoteResultResponse,
)


def vote(
    db: Session, user_id: int, target_type: str, target_id: int, value: int
) -> VoteResultResponse:
    """投票（US-07/E-04 toggle 语义）：create/cancel/switch 三分支，同一事务内
    维护目标 vote_score 快照与作者声誉（需求文档 4.7），末尾统一 commit（D-8）。
    """
    domain.ensure_vote_value(value)
    if target_type not in (domain.TARGET_QUESTION, domain.TARGET_ANSWER):
        raise domain.VoteTargetTypeError()
    target = repository.get_vote_target(db, target_type, target_id)
    if target is None or not domain.is_visible(target.deleted_at):
        raise domain.VoteTargetNotFoundError()

    current = repository.get_vote_value(db, target_type, target_id, user_id)
    action = domain.next_vote_action(current, value)
    if action == "cancel":
        repository.delete_vote(db, target_type, target_id, user_id)
        repository.adjust_vote_score(db, target_type, target_id, -value)
        _apply_author_reputation_on_cancel(db, target, target_type, value)
    elif action == "switch":
        repository.update_vote(db, target_type, target_id, user_id, value)
        repository.adjust_vote_score(db, target_type, target_id, 2 * value)
        # 改票 = 旧票冲销 + 新票生效，两条流水（积分变化必有流水）
        _apply_author_reputation_on_cancel(db, target, target_type, current)
        _apply_author_reputation_on_vote(db, target, target_type, value)
    else:
        repository.create_vote(db, target_type, target_id, user_id, value)
        repository.adjust_vote_score(db, target_type, target_id, value)
        _apply_author_reputation_on_vote(db, target, target_type, value)

    db.commit()
    vote_score = repository.get_vote_score(db, target_type, target_id)
    my_vote = repository.get_vote_value(db, target_type, target_id, user_id) or 0
    return VoteResultResponse(
        target_type=target_type, target_id=target_id, vote_score=vote_score, my_vote=my_vote
    )


def _target_course_id(db: Session, target, target_type: str) -> int | None:
    """目标所属课程（流水快照用）：问题直接取列，回答经其问题。"""
    if target_type == domain.TARGET_QUESTION:
        return target.course_id
    return repository.get_question_course_id(db, target.question_id)


def _apply_author_reputation_on_vote(
    db: Session, target, target_type: str, value: int
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
        course_id=_target_course_id(db, target, target_type),
    )


def _apply_author_reputation_on_cancel(
    db: Session, target, target_type: str, cancelled_value: int
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
        course_id=_target_course_id(db, target, target_type),
    )


def grant_reputation(
    db: Session, user_id: int, delta: int, reason: str, ref_type: str, ref_id: int,
    course_id: int | None = None,
) -> None:
    """声誉写入唯一入口（架构说明 4.B/需求 4.7）：总分与流水同事务，flush 不 commit（D-8）。

    供本模块 vote 与 qa.service.accept_answer（采纳 +15）复用；调用方负责事务提交。
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
    counts = repository.get_public_content_counts(db, user_id)
    return PublicReputationResponse(
        user_id=user.id,
        username=user.username,
        reputation_score=user.reputation_score,
        question_count=counts["question_count"],
        answer_count=counts["answer_count"],
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
        candidates = repository.list_rank(db, period, course_id)
        usernames = identity_service.get_usernames_by_ids(
            db, [user_id for user_id, _ in candidates]
        )
        items = [
            RankItem(user_id=user_id, username=usernames[user_id], score=score)
            for user_id, score in candidates
            if user_id in usernames
        ][:domain.RANK_LIMIT]
    return RankResponse(items=items)


def get_my_vote_map(
    db: Session, user_id: int, target_type: str, target_ids: list[int]
) -> dict[int, int]:
    """批量取当前用户投票方向（qa 列表/详情回填 my_vote，防 N+1；跨模块公开函数 D-5）。"""
    if not target_ids:
        return {}
    return repository.get_my_vote_map(db, user_id, target_type, target_ids)
