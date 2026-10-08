# qa 数据访问：查询与写入函数，仅被本模块 service 调用（架构规则 2.3-3）
# 分层基线 D-2：本文件是模块内唯一允许 import models 的地方；出参一律 schemas。
# 事务约定 D-8：本层只 flush 不 commit，事务边界（commit）在 service 用例层。
from datetime import datetime

from sqlalchemy import and_, func, or_, select, union_all
from sqlalchemy.orm import Session, aliased

from app.modules.qa import domain
from app.modules.qa.models import Answer, Comment, Question, QuestionTag, Tag
from app.modules.qa.schemas import (
    AnswerResponse,
    CommentResponse,
    PublicContentCounts,
    QuestionResponse,
    TagBrief,
    TagResponse,
    VoteTargetData,
)


def get_vote_target(
    db: Session, target_type: str, target_id: int
) -> VoteTargetData | None:
    if target_type == "question":
        row = db.query(
            Question.id, Question.author_id, Question.deleted_at, Question.course_id
        ).filter(Question.id == target_id).first()
    else:
        # 回答只检查自身软删；父问题仅提供课程快照，不参与可见性过滤。
        row = db.query(
            Answer.id, Answer.author_id, Answer.deleted_at, Question.course_id
        ).outerjoin(Question, Question.id == Answer.question_id).filter(
            Answer.id == target_id
        ).first()
    return VoteTargetData(**row._mapping) if row else None


def lock_question(db: Session, question_id: int) -> QuestionResponse | None:
    question = (
        db.query(Question).filter(Question.id == question_id)
        .with_for_update().populate_existing().first()
    )
    return QuestionResponse.model_validate(question) if question else None


def lock_answer_context(
    db: Session, answer_id: int
) -> tuple[QuestionResponse | None, AnswerResponse | None]:
    # 父 id 不可变；定位查询不加锁，实际状态在 Question → Answer 加锁后刷新。
    row = db.query(Answer.question_id).filter(Answer.id == answer_id).first()
    if row is None:
        return None, None
    question = lock_question(db, row[0])
    answer = (
        db.query(Answer).filter(Answer.id == answer_id)
        .with_for_update().populate_existing().first()
    )
    return question, AnswerResponse.model_validate(answer) if answer else None


def lock_vote_target(
    db: Session, target_type: str, target_id: int
) -> VoteTargetData | None:
    if target_type == "question":
        target = lock_question(db, target_id)
        course_id = target.course_id if target else None
    else:
        question, target = lock_answer_context(db, target_id)
        course_id = question.course_id if question else None
    if target is None:
        return None
    return VoteTargetData(id=target.id, author_id=target.author_id,
                          deleted_at=target.deleted_at, course_id=course_id)


def adjust_vote_score(db: Session, target_type: str, target_id: int, delta: int) -> None:
    model = Question if target_type == "question" else Answer
    db.query(model).filter(model.id == target_id).update(
        {model.vote_score: model.vote_score + delta}, synchronize_session=False
    )
    db.flush()


def get_vote_score(db: Session, target_type: str, target_id: int) -> int:
    model = Question if target_type == "question" else Answer
    row = db.query(model.vote_score).filter(model.id == target_id).first()
    return row[0] if row else 0


def get_public_content_counts(db: Session, user_id: int) -> PublicContentCounts:
    question_count = db.query(func.count(Question.id)).filter(
        Question.author_id == user_id, Question.deleted_at.is_(None)
    ).scalar()
    answer_count = db.query(func.count(Answer.id)).filter(
        Answer.author_id == user_id, Answer.deleted_at.is_(None)
    ).scalar()
    return PublicContentCounts(
        question_count=question_count or 0, answer_count=answer_count or 0
    )


SORT_LATEST = "latest"
SORT_HOT = "hot"


def get_by_id(db: Session, question_id: int) -> QuestionResponse | None:
    """按主键查询问题（含已软删，可见性由 domain.is_visible 在 service 判定）。"""
    question = db.get(Question, question_id)
    return QuestionResponse.model_validate(question) if question else None


def create_question(
    db: Session, title: str, body: str, course_id: int, author_id: int
) -> QuestionResponse:
    """新建问题，默认 published 状态（标题/正文已由 domain 清洗截断）。"""
    question = Question(title=title, body=body, course_id=course_id, author_id=author_id)
    db.add(question)
    db.flush()
    return QuestionResponse.model_validate(question)


def update_question(
    db: Session, question_id: int, title: str | None, body: str | None
) -> QuestionResponse:
    """编辑问题字段（None 表示不修改）。"""
    question = db.get(Question, question_id)
    if question is None:
        raise domain.QuestionNotFoundError()
    if title is not None:
        question.title = title
    if body is not None:
        question.body = body
    db.flush()
    return QuestionResponse.model_validate(question)


def soft_delete(db: Session, question_id: int) -> None:
    """软删除：仅标记 deleted_at，行保留供管理员追溯（E-10）。"""
    question = db.get(Question, question_id, populate_existing=True, with_for_update=True)
    if question is None:
        raise domain.QuestionNotFoundError()
    question.deleted_at = datetime.now()
    db.flush()


def increment_view(db: Session, question_id: int) -> None:
    """浏览数原子自增（详情接口每次 +1）。"""
    db.query(Question).filter(Question.id == question_id).update(
        {Question.view_count: Question.view_count + 1}
    )
    db.flush()


def list_questions(
    db: Session, page: int, page_size: int, course_id: int | None,
    sort: str, unresolved: bool, keyword: str | None, tag_id: int | None = None,
    created_from: datetime | None = None, created_before: datetime | None = None,
    tag_names: list[str] | None = None,
) -> tuple[list[QuestionResponse], int]:
    """分页列问题：软删不可见（E-10）；支持课程/标签/未解决/关键词筛选与最新/热度排序。

    hot 按投票分降序（T-08 起用 vote_score 快照，替代原浏览数口径）；
    tag_id 筛选经关联表 join（(question_id, tag_id) 唯一约束保证不产生重复行）。
    """
    query = db.query(Question).filter(Question.deleted_at.is_(None))
    if course_id is not None:
        query = query.filter(Question.course_id == course_id)
    if unresolved:
        query = query.filter(Question.status == domain.STATUS_PUBLISHED)
    if keyword:
        escaped = keyword.replace("!", "!!").replace("%", "!%").replace("_", "!_")
        like = f"%{escaped}%"
        query = query.filter(or_(
            Question.title.like(like, escape="!"), Question.body.like(like, escape="!")
        ))
    if created_from is not None:
        query = query.filter(Question.created_at >= created_from)
    if created_before is not None:
        query = query.filter(Question.created_at < created_before)
    if tag_id is not None:
        query = query.join(QuestionTag, QuestionTag.question_id == Question.id).filter(
            QuestionTag.tag_id == tag_id
        )
    if tag_names:
        tagged_questions = select(QuestionTag.question_id).join(
            Tag, Tag.id == QuestionTag.tag_id
        ).where(Tag.name.in_(tag_names))
        query = query.filter(Question.id.in_(tagged_questions))
    total = query.count()
    if sort == SORT_HOT:
        query = query.order_by(
            Question.vote_score.desc(), Question.created_at.desc(), Question.id.desc()
        )
    else:
        query = query.order_by(Question.created_at.desc(), Question.id.desc())
    offset = (page - 1) * page_size
    questions = query.offset(offset).limit(page_size).all()
    return [QuestionResponse.model_validate(q) for q in questions], total


# ---------- 回答（T-05） ----------

ANSWER_SORT_LATEST = "latest"
ANSWER_SORT_VOTES = "votes"
ANSWER_SORT_ACCEPTED = "accepted"


def get_answer_by_id(db: Session, answer_id: int) -> AnswerResponse | None:
    """按主键查询回答（含已软删，可见性由 domain.is_visible 在 service 判定）。"""
    answer = db.get(Answer, answer_id)
    return AnswerResponse.model_validate(answer) if answer else None


def create_answer(
    db: Session, question_id: int, author_id: int, body: str
) -> AnswerResponse:
    """新建回答（正文已由 domain 清洗截断）。"""
    answer = Answer(question_id=question_id, author_id=author_id, body=body)
    db.add(answer)
    db.flush()
    return AnswerResponse.model_validate(answer)


def update_answer(db: Session, answer_id: int, body: str) -> AnswerResponse:
    """编辑回答正文。"""
    answer = db.get(Answer, answer_id)
    if answer is None:
        raise domain.AnswerNotFoundError()
    answer.body = body
    db.flush()
    return AnswerResponse.model_validate(answer)


def soft_delete_answer(db: Session, answer_id: int) -> None:
    """软删除回答：仅标记 deleted_at，行保留供管理员追溯（E-10）。"""
    answer = db.get(Answer, answer_id, populate_existing=True, with_for_update=True)
    if answer is None:
        raise domain.AnswerNotFoundError()
    answer.deleted_at = datetime.now()
    db.flush()


def list_answers(
    db: Session, question_id: int, accepted_answer_id: int | None,
    sort: str, page: int, page_size: int,
) -> tuple[list[AnswerResponse], int]:
    """分页列某问题的可见回答（E-10）；accepted 排序将被采纳回答置顶突出展示。

    votes 按投票分降序（T-08 起用 vote_score 快照）。
    """
    query = db.query(Answer).filter(
        Answer.question_id == question_id, Answer.deleted_at.is_(None)
    )
    total = query.count()
    if sort == ANSWER_SORT_ACCEPTED and accepted_answer_id is not None:
        query = query.order_by(
            (Answer.id == accepted_answer_id).desc(),
            Answer.created_at.desc(),
            Answer.id.desc(),
        )
    elif sort == ANSWER_SORT_VOTES:
        query = query.order_by(
            Answer.vote_score.desc(), Answer.created_at.desc(), Answer.id.desc()
        )
    else:
        # id 次级排序：时间戳秒级精度下同秒创建保持稳定顺序
        query = query.order_by(Answer.created_at.desc(), Answer.id.desc())
    offset = (page - 1) * page_size
    answers = query.offset(offset).limit(page_size).all()
    return [AnswerResponse.model_validate(a) for a in answers], total


def count_answers_by_question_ids(db: Session, question_ids: list[int]) -> dict[int, int]:
    """批量统计问题的可见回答数（列表页回填 answer_count，一次 GROUP BY 避免 N+1）。"""
    if not question_ids:
        return {}
    rows = (
        db.query(Answer.question_id, func.count(Answer.id))
        .filter(Answer.question_id.in_(question_ids), Answer.deleted_at.is_(None))
        .group_by(Answer.question_id)
        .all()
    )
    return {question_id: count for question_id, count in rows}


def accept_answer(db: Session, question_id: int, answer_id: int) -> None:
    """采纳写入：记录被采纳回答并把问题状态迁移为 resolved（US-06）。

    调用方先锁定同题 Question 并校验未采纳，串行化不同回答的采纳竞争（E-05）。
    """
    question = db.get(Question, question_id, populate_existing=True, with_for_update=True)
    if question is None:
        raise domain.QuestionNotFoundError()
    question.accepted_answer_id = answer_id
    question.status = domain.STATUS_RESOLVED
    db.flush()


def unaccept_answer(db: Session, question_id: int) -> None:
    """撤销采纳：清空引用并把问题状态回退为 published（已采纳回答被软删时级联）。"""
    question = db.get(Question, question_id, populate_existing=True, with_for_update=True)
    if question is None:
        raise domain.QuestionNotFoundError()
    question.accepted_answer_id = None
    question.status = domain.STATUS_PUBLISHED
    db.flush()


def set_recommend_flag(db: Session, answer_id: int, recommended: bool) -> None:
    """助教推荐标记写入（E-13：仅展示标记，不改问题状态与采纳权）。"""
    answer = db.get(Answer, answer_id)
    if answer is None:
        raise domain.AnswerNotFoundError()
    answer.recommended_by_assistant = recommended
    db.flush()


def set_certified_flag(db: Session, answer_id: int, certified: bool) -> None:
    """教师优质内容认证写入（D9 定案：POST 置位 / DELETE 取消）。"""
    answer = db.get(Answer, answer_id)
    if answer is None:
        raise domain.AnswerNotFoundError()
    answer.certified_by_teacher = certified
    db.flush()


# ---------- 评论（T-06） ----------


def get_comment_by_id(db: Session, comment_id: int) -> CommentResponse | None:
    """按主键查询评论（含已软删，可见性由 domain.is_visible 在 service 判定）。"""
    comment = db.get(Comment, comment_id)
    return CommentResponse.model_validate(comment) if comment else None


def create_comment(
    db: Session, body: str, author_id: int,
    question_id: int | None, answer_id: int | None, parent_id: int | None,
) -> CommentResponse:
    """新建评论或二级回复（正文已由 domain 清洗截断）。"""
    comment = Comment(
        body=body,
        author_id=author_id,
        question_id=question_id,
        answer_id=answer_id,
        parent_id=parent_id,
    )
    db.add(comment)
    db.flush()
    return CommentResponse.model_validate(comment)


def soft_delete_comment(db: Session, comment_id: int) -> None:
    """软删除评论：仅标记 deleted_at，行保留供管理员追溯（E-10）。"""
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise domain.CommentNotFoundError()
    comment.deleted_at = datetime.now()
    db.flush()


def soft_delete_replies(db: Session, parent_id: int) -> None:
    """级联软删某顶级评论的全部直接回复（顶级评论被删时避免回复孤儿化）。"""
    db.query(Comment).filter(
        Comment.parent_id == parent_id, Comment.deleted_at.is_(None)
    ).update({Comment.deleted_at: datetime.now()}, synchronize_session=False)
    db.flush()


def list_top_comments(
    db: Session, question_id: int | None, answer_id: int | None, page: int, page_size: int
) -> tuple[list[CommentResponse], int]:
    """分页列某目标的顶级评论（软删不可见 E-10），按创建时间正序（对话时序）。"""
    query = db.query(Comment).filter(
        Comment.deleted_at.is_(None), Comment.parent_id.is_(None)
    )
    if question_id is not None:
        query = query.filter(Comment.question_id == question_id)
    else:
        query = query.filter(Comment.answer_id == answer_id)
    total = query.count()
    offset = (page - 1) * page_size
    comments = (
        query.order_by(Comment.created_at.asc(), Comment.id.asc())
        .offset(offset)
        .limit(page_size)
        .all()
    )
    return [CommentResponse.model_validate(c) for c in comments], total


def list_replies_by_parent_ids(
    db: Session, parent_ids: list[int]
) -> list[CommentResponse]:
    """批量取一批顶级评论的可见回复（避免 N+1），按创建时间正序。"""
    if not parent_ids:
        return []
    replies = (
        db.query(Comment)
        .filter(Comment.parent_id.in_(parent_ids), Comment.deleted_at.is_(None))
        .order_by(Comment.created_at.asc(), Comment.id.asc())
        .all()
    )
    return [CommentResponse.model_validate(c) for c in replies]


# ---------- 标签（T-07） ----------


def get_tag_by_id(db: Session, tag_id: int) -> TagBrief | None:
    """按主键查询标签（供 service 校验请求体引用的标签存在性；出参 schema，D-2）。"""
    tag = db.get(Tag, tag_id)
    return TagBrief(id=tag.id, name=tag.name, type=tag.type) if tag else None


def get_tag_by_name(db: Session, name: str) -> TagBrief | None:
    """按名称精确查询标签（内联自定义标签同名复用，名称全局唯一）。"""
    tag = db.query(Tag).filter(Tag.name == name).first()
    return TagBrief(id=tag.id, name=tag.name, type=tag.type) if tag else None


def create_tag(db: Session, name: str, tag_type: str) -> TagBrief:
    """新建标签（名称已由 domain 清洗截断；类型为 domain 常量）。"""
    tag = Tag(name=name, type=tag_type)
    db.add(tag)
    db.flush()
    return TagBrief(id=tag.id, name=tag.name, type=tag.type)


def get_bound_tag_ids(db: Session, question_id: int) -> list[int]:
    """查询问题已绑定的标签 id（E-03 判重与上限计算用）。"""
    rows = db.query(QuestionTag.tag_id).filter(QuestionTag.question_id == question_id).all()
    return [tag_id for (tag_id,) in rows]


def bind_tags(db: Session, question_id: int, tag_ids: list[int]) -> None:
    """写入问题-标签绑定行（并发竞争由 uq_question_tags_pair 唯一约束兜底，E-03）。"""
    for tag_id in tag_ids:
        db.add(QuestionTag(question_id=question_id, tag_id=tag_id))
    db.flush()


def get_tags_by_question_ids(
    db: Session, question_ids: list[int]
) -> dict[int, list[TagBrief]]:
    """批量取一批问题的标签（列表/详情回填 tags，一次查询避免 N+1），按绑定时间正序。"""
    if not question_ids:
        return {}
    rows = (
        db.query(QuestionTag.question_id, Tag)
        .join(Tag, Tag.id == QuestionTag.tag_id)
        .filter(QuestionTag.question_id.in_(question_ids))
        .order_by(QuestionTag.created_at.asc(), Tag.id.asc())
        .all()
    )
    result: dict[int, list[TagBrief]] = {}
    for question_id, tag in rows:
        result.setdefault(question_id, []).append(
            TagBrief(id=tag.id, name=tag.name, type=tag.type)
        )
    return result


def list_tags(db: Session, keyword: str | None, hot: bool) -> list[TagResponse]:
    """标签列表：question_count 只统计未软删问题（E-10，双重 outerjoin 保持零绑定标签）。

    hot=true 按绑定数降序取前 HOT_TAGS_LIMIT 个，且只含有绑定的标签（热门语义）。
    """
    query = (
        db.query(Tag, func.count(Question.id))
        .outerjoin(QuestionTag, QuestionTag.tag_id == Tag.id)
        .outerjoin(
            Question,
            (Question.id == QuestionTag.question_id) & Question.deleted_at.is_(None),
        )
        .group_by(Tag.id)
    )
    if keyword:
        query = query.filter(Tag.name.like(f"%{keyword}%"))
    if hot:
        query = query.having(func.count(Question.id) > 0).order_by(
            func.count(Question.id).desc(), Tag.id.asc()
        ).limit(domain.HOT_TAGS_LIMIT)
    else:
        query = query.order_by(Tag.id.asc())
    return [
        TagResponse(id=tag.id, name=tag.name, type=tag.type, question_count=count)
        for tag, count in query.all()
    ]


def list_related_questions(db: Session, question_id: int) -> list[QuestionResponse]:
    source = aliased(QuestionTag)
    shared = (
        db.query(QuestionTag.question_id, func.count().label("shared_count"))
        .join(source, source.tag_id == QuestionTag.tag_id)
        .filter(source.question_id == question_id, QuestionTag.question_id != question_id)
        .group_by(QuestionTag.question_id).subquery()
    )
    rows = (
        db.query(Question).join(shared, shared.c.question_id == Question.id)
        .filter(Question.deleted_at.is_(None))
        .order_by(shared.c.shared_count.desc(), Question.vote_score.desc(),
                  Question.created_at.desc(), Question.id.desc()).limit(10).all()
    )
    return [QuestionResponse.model_validate(row) for row in rows]


def count_questions_by_course_ids(db: Session, course_ids: list[int]) -> dict[int, int]:
    if not course_ids:
        return {}
    return dict(db.query(Question.course_id, func.count(Question.id)).filter(
        Question.course_id.in_(course_ids), Question.deleted_at.is_(None)
    ).group_by(Question.course_id).all())


def list_course_tags(db: Session, course_id: int) -> list[TagResponse]:
    count = func.count(Question.id)
    rows = db.query(Tag, count).join(QuestionTag, QuestionTag.tag_id == Tag.id).join(
        Question, Question.id == QuestionTag.question_id
    ).filter(Question.course_id == course_id, Question.deleted_at.is_(None)).group_by(
        Tag.id
    ).order_by(count.desc(), Tag.id.asc()).limit(10).all()
    return [TagResponse(id=tag.id, name=tag.name, type=tag.type, question_count=n)
            for tag, n in rows]


def list_course_activity_batch(
    db: Session, course_id: int, last_count: int | None, last_user_id: int | None,
) -> list[tuple[int, int]]:
    questions = select(Question.author_id.label("user_id")).where(
        Question.course_id == course_id, Question.deleted_at.is_(None)
    )
    answers = select(Answer.author_id.label("user_id")).join(
        Question, Question.id == Answer.question_id
    ).where(Question.course_id == course_id, Question.deleted_at.is_(None),
            Answer.deleted_at.is_(None))
    activity = union_all(questions, answers).subquery()
    counts = select(activity.c.user_id, func.count().label("activity_count")).group_by(
        activity.c.user_id
    ).subquery()
    query = db.query(counts.c.user_id, counts.c.activity_count)
    if last_count is not None and last_user_id is not None:
        query = query.filter(or_(counts.c.activity_count < last_count, and_(
            counts.c.activity_count == last_count, counts.c.user_id > last_user_id
        )))
    return [(uid, n) for uid, n in query.order_by(
        counts.c.activity_count.desc(), counts.c.user_id.asc()
    ).limit(100).all()]
