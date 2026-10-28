# qa 业务层：用例编排、事务边界与授权决策
# 分层基线 D-1/D-2/D-3：规则在 domain.py，ORM 留在 repository，本层不碰 HTTP 协议。
# 签名约定 D-7：入参只收基本类型；事务约定 D-8：写用例末尾显式 db.commit()。
from datetime import datetime

from sqlalchemy.orm import Session

from app.modules.courses import domain as courses_domain
from app.modules.courses import service as courses_service
from app.modules.identity import service as identity_service
from app.modules.qa import domain, repository
from app.modules.qa.schemas import (
    AcceptedAnswerData,
    AnswerListItemResponse,
    AnswerResponse,
    AnswerUserListItemResponse,
    CommentListItemResponse,
    CommentReplyResponse,
    ModerationContentData,
    PatrolContentItem,
    PreparedAnswerData,
    PreparedCommentData,
    PublicContentCounts,
    QuestionDetailResponse,
    QuestionListItemResponse,
    QuestionResponse,
    RecentQuestionContent,
    TagBrief,
    TagResponse,
    VoteTargetData,
)


def list_recent_question_contents(
    db: Session, course_id: int, created_from: datetime, limit: int
) -> list[RecentQuestionContent]:
    """跨模块公开函数（D-5）：课程近期可见问题正文（KN-R02 周报分析只读）。

    只读查询：不更新浏览量、不含作者与互动数据；软删/隐藏排除由 repository 过滤。
    """
    questions = repository.list_recent_questions(db, course_id, created_from, limit)
    tags_map = repository.get_tags_by_question_ids(db, [q.id for q in questions])
    return [
        RecentQuestionContent(
            id=q.id,
            title=q.title,
            body=q.body,
            tags=tags_map.get(q.id, []),
            created_at=q.created_at,
        )
        for q in questions
    ]


def get_vote_target(
    db: Session, target_type: str, target_id: int
) -> VoteTargetData | None:
    """纯读取内部投票目标，含软删状态；可见性由投票用例判定。"""
    return repository.get_vote_target(db, target_type, target_id)


def lock_vote_target(
    db: Session, target_type: str, target_id: int
) -> VoteTargetData | None:
    return repository.lock_vote_target(db, target_type, target_id)


def adjust_vote_score(db: Session, target_type: str, target_id: int, delta: int) -> None:
    """票分快照增量写入，只 flush，由调用方统一提交。"""
    repository.adjust_vote_score(db, target_type, target_id, delta)


def get_vote_score(db: Session, target_type: str, target_id: int) -> int:
    return repository.get_vote_score(db, target_type, target_id)


def get_public_content_counts(db: Session, user_id: int) -> PublicContentCounts:
    return repository.get_public_content_counts(db, user_id)


def _is_truncated(title: str, body: str) -> bool:
    """E-02 提示标志：原始输入超限即提示（清洗只会缩短，不影响判断方向）。"""
    return len(title.strip()) > domain.TITLE_MAX_LEN or len(body) > domain.BODY_MAX_LEN


def _resolve_tag_refs(db: Session, tag_refs: list[int | str]) -> list[int]:
    """把绑定入参归一为标签 id：int 校验存在性（不存在 400）；str 内联取/建自定义标签。

    str 经 normalize_tag_name（E-02 截断 + 空名 400）；同名已存在则复用。
    本函数只在用户显式提交（发布/绑定接口）时执行——E-09：未经确认不产生任何写入。
    """
    ids: list[int] = []
    for ref in tag_refs:
        if isinstance(ref, int):
            if repository.get_tag_by_id(db, ref) is None:
                raise domain.TagNotFoundError()
            ids.append(ref)
            continue
        name = domain.normalize_tag_name(ref)
        existing = repository.get_tag_by_name(db, name)
        if existing is not None:
            ids.append(existing.id)
        else:
            ids.append(repository.create_tag(db, name, domain.TAG_TYPE_CUSTOM).id)
    return ids


def publish_question(
    db: Session, user_id: int, title: str, body: str, course_id: int,
    tag_ids: list[int] | None = None,
) -> tuple[QuestionResponse, bool]:
    """发布问题：非空校验（E-01）→ 清洗截断（E-02/X-03）→ 课程校验（404）→
    发布资格（403：负责教师天然可发，其余须已加入）→ 入库 → 绑定标签（E-03）。
    """
    domain.ensure_not_empty(title, body)
    truncated = _is_truncated(title, body)
    course = courses_service.get_course(db, course_id)
    if course is None:
        raise courses_domain.CourseNotFoundError()
    if course.teacher_id != user_id and not courses_service.is_member(db, course_id, user_id):
        raise domain.CoursePostDeniedError()
    question = repository.create_question(
        db,
        title=domain.truncate_title(title),
        body=domain.sanitize_and_truncate_body(body),
        course_id=course_id,
        author_id=user_id,
    )
    if tag_ids:
        resolved = _resolve_tag_refs(db, tag_ids)
        domain.ensure_not_already_bound([], resolved)
        domain.ensure_tag_count_within_limit(0, len(resolved))
        repository.bind_tags(db, question.id, resolved)
    db.commit()
    # TODO(agent): QuestionPosted 事件发布点（治理订阅，一期仅注释，见架构说明 4.A）
    return question, truncated


def list_questions(
    db: Session, page: int, page_size: int, course_id: int | None,
    sort: str, unresolved: bool, keyword: str | None,
    tag_id: int | None = None,
    created_from: datetime | None = None, created_before: datetime | None = None,
    tag_names: list[str] | None = None,
    author_id: int | None = None,
) -> tuple[list[QuestionListItemResponse], int]:
    """问题列表：作者名、回答数与标签批量取；票态由组合用例填充。"""
    questions, total = repository.list_questions(
        db, page, page_size, course_id, sort, unresolved, keyword, tag_id,
        created_from, created_before, tag_names, author_id,
    )
    return assemble_question_cards(db, questions), total


def assemble_question_cards(
    db: Session, questions: list[QuestionResponse]
) -> list[QuestionListItemResponse]:
    names = identity_service.get_usernames_by_ids(db, [q.author_id for q in questions])
    course_names = courses_service.get_course_names_by_ids(db, [q.course_id for q in questions])
    counts = repository.count_answers_by_question_ids(db, [q.id for q in questions])
    tags_map = repository.get_tags_by_question_ids(db, [q.id for q in questions])
    items = [
        QuestionListItemResponse(
            id=q.id,
            title=q.title,
            course_id=q.course_id,
            course_name=course_names.get(q.course_id, ""),
            author=names.get(q.author_id, ""),
            tags=tags_map.get(q.id, []),
            status=q.status,
            vote_score=q.vote_score,
            my_vote=0,
            answer_count=counts.get(q.id, 0),
            view_count=q.view_count,
            has_accepted=q.accepted_answer_id is not None,
            created_at=q.created_at,
        )
        for q in questions
    ]
    return items


def get_question_detail(
    db: Session, question_id: int
) -> QuestionDetailResponse:
    """问题详情：软删不可见（E-10）；浏览数原子 +1；回答经 GET /questions/{id}/answers 分页获取。"""
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at, question.is_hidden):
        raise domain.QuestionNotFoundError()
    names = identity_service.get_usernames_by_ids(db, [question.author_id])
    course_names = courses_service.get_course_names_by_ids(db, [question.course_id])
    tags = repository.get_tags_by_question_ids(db, [question.id]).get(question.id, [])
    repository.increment_view(db, question_id)
    return QuestionDetailResponse(
        id=question.id,
        title=question.title,
        body=question.body,
        course_id=question.course_id,
        course_name=course_names.get(question.course_id, ""),
        author=names.get(question.author_id, ""),
        tags=tags,
        status=question.status,
        vote_score=question.vote_score,
        my_vote=0,
        accepted_answer_id=question.accepted_answer_id,
        view_count=question.view_count + 1,
        created_at=question.created_at,
        updated_at=question.updated_at,
    )


def update_question(
    db: Session, user_id: int, question_id: int, title: str | None, body: str | None
) -> tuple[QuestionResponse, bool]:
    """编辑问题：仅作者；修改的字段经非空校验（E-01）与清洗截断（E-02/X-03）。"""
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at, question.is_hidden):
        raise domain.QuestionNotFoundError()
    domain.ensure_can_edit(question.author_id, user_id)
    truncated = False
    if title is not None:
        domain.ensure_not_blank(title)
        truncated = truncated or len(title.strip()) > domain.TITLE_MAX_LEN
        title = domain.truncate_title(title)
    if body is not None:
        domain.ensure_not_blank(body)
        truncated = truncated or len(body) > domain.BODY_MAX_LEN
        body = domain.sanitize_and_truncate_body(body)
    updated = repository.update_question(db, question_id, title, body)
    db.commit()
    return updated, truncated


def delete_question(db: Session, user_role: str, user_id: int, question_id: int) -> None:
    """软删除问题：作者或管理员（E-10），行保留供管理员追溯。"""
    try:
        question = repository.lock_question(db, question_id)
        if question is None or not domain.is_visible(question.deleted_at, question.is_hidden):
            raise domain.QuestionNotFoundError()
        domain.ensure_can_delete(user_role, question.author_id, user_id)
        repository.soft_delete(db, question_id)
        db.commit()
    except Exception:
        db.rollback()
        raise


# ---------- 回答与采纳（T-05） ----------


def prepare_answer(
    db: Session, user_id: int, question_id: int, body: str
) -> PreparedAnswerData:
    """发布回答：问题可见（404）→ 非空（E-01）→ 清洗截断（E-02/X-03）→ 入库。

    回答资格：任何登录用户可回答可见问题（学生端接口文档 §4 未设课程成员限制）；
    被封禁用户已被 get_current_user 统一拦截（E-07）。
    """
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at, question.is_hidden):
        raise domain.QuestionNotFoundError()
    domain.ensure_not_blank(body)
    truncated = len(body) > domain.BODY_MAX_LEN
    answer = repository.create_answer(
        db, question_id, user_id, domain.sanitize_and_truncate_body(body)
    )
    return PreparedAnswerData(
        answer=answer, truncated=truncated, question_author_id=question.author_id
    )


def list_answers(
    db: Session, question_id: int, sort: str, page: int, page_size: int
) -> tuple[list[AnswerListItemResponse], int]:
    """回答列表：问题软删则 404；is_accepted 由问题采纳引用判定（US-06）。"""
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at, question.is_hidden):
        raise domain.QuestionNotFoundError()
    answers, total = repository.list_answers(
        db, question_id, question.accepted_answer_id, sort, page, page_size
    )
    names = identity_service.get_usernames_by_ids(db, [a.author_id for a in answers])
    items = [
        AnswerListItemResponse(
            id=a.id,
            author=names.get(a.author_id, ""),
            body=a.body,
            vote_score=a.vote_score,
            my_vote=0,
            is_accepted=a.id == question.accepted_answer_id,
            recommended_by_assistant=a.recommended_by_assistant,
            certified_by_teacher=a.certified_by_teacher,
            created_at=a.created_at,
        )
        for a in answers
    ]
    return items, total


def list_user_answers(
    db: Session, user_id: int, page: int, page_size: int,
) -> tuple[list[AnswerUserListItemResponse], int]:
    identity_service.get_by_id(db, user_id)
    return repository.list_user_answers(db, user_id, page, page_size)


def _ensure_question_visible(db: Session, question_id: int) -> QuestionResponse:
    """父问题可见性（E-10）：问题软删后其下回答不可再编辑/推荐/评论/认证。

    返回已校验的问题（供 certify 继续取 course_id），不返回给无需它的调用方也可忽略。
    """
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at, question.is_hidden):
        raise domain.QuestionNotFoundError()
    return question


def update_answer(
    db: Session, user_id: int, answer_id: int, body: str | None
) -> tuple[AnswerResponse, bool]:
    """编辑回答：仅作者；body None 表示不修改（PATCH 部分更新语义，空对象为无操作）。"""
    answer = repository.get_answer_by_id(db, answer_id)
    if answer is None or not domain.is_visible(answer.deleted_at, answer.is_hidden):
        raise domain.AnswerNotFoundError()
    _ensure_question_visible(db, answer.question_id)
    domain.ensure_answer_can_edit(answer.author_id, user_id)
    if body is None:
        return answer, False
    domain.ensure_not_blank(body)
    truncated = len(body) > domain.BODY_MAX_LEN
    updated = repository.update_answer(
        db, answer_id, domain.sanitize_and_truncate_body(body)
    )
    db.commit()
    return updated, truncated


def delete_answer(db: Session, user_role: str, user_id: int, answer_id: int) -> None:
    """软删除回答：作者或管理员（E-10）。

    被采纳回答被删时，同一事务撤销问题采纳并回退状态，避免悬空引用（US-06 一致性）。
    删除是"只减可见性"操作且承担已采纳清理职责，故不受父问题软删限制（规格 E-10 未禁止）。
    """
    try:
        question, answer = repository.lock_answer_context(db, answer_id)
        if answer is None or not domain.is_visible(answer.deleted_at, answer.is_hidden):
            raise domain.AnswerNotFoundError()
        domain.ensure_answer_can_delete(user_role, answer.author_id, user_id)
        if question is not None and question.accepted_answer_id == answer_id:
            repository.unaccept_answer(db, answer.question_id)
        repository.soft_delete_answer(db, answer_id)
        db.commit()
    except Exception:
        db.rollback()
        raise


def prepare_answer_acceptance(
    db: Session, user_id: int, answer_id: int
) -> AcceptedAnswerData:
    """校验采纳权限并写入内容状态，只 flush，由组合用例统一提交。"""
    question, answer = repository.lock_answer_context(db, answer_id)
    if answer is None or not domain.is_visible(answer.deleted_at, answer.is_hidden):
        raise domain.AnswerNotFoundError()
    if question is None or not domain.is_visible(question.deleted_at, question.is_hidden):
        raise domain.QuestionNotFoundError()
    domain.ensure_can_accept(question.author_id, user_id)
    domain.ensure_not_accepted(question.accepted_answer_id)
    repository.accept_answer(db, question.id, answer.id)
    return AcceptedAnswerData(
        question_id=question.id, answer_id=answer.id, author_id=answer.author_id,
        course_id=question.course_id
    )


def recommend_answer(db: Session, answer_id: int, recommended: bool) -> dict:
    """助教推荐标记（US-20/E-13）：能力位由 require_graduate_assistant 在路由层把关。"""
    answer = repository.get_answer_by_id(db, answer_id)
    if answer is None or not domain.is_visible(answer.deleted_at, answer.is_hidden):
        raise domain.AnswerNotFoundError()
    _ensure_question_visible(db, answer.question_id)
    repository.set_recommend_flag(db, answer_id, recommended)
    db.commit()
    return {"answer_id": answer.id, "recommended_by_assistant": recommended}


def certify_answer(db: Session, user_id: int, answer_id: int, certified: bool) -> dict:
    """优质内容认证（D9 定案）：仅回答所在课程的负责教师，POST 置位 / DELETE 取消。"""
    answer = repository.get_answer_by_id(db, answer_id)
    if answer is None or not domain.is_visible(answer.deleted_at, answer.is_hidden):
        raise domain.AnswerNotFoundError()
    question = _ensure_question_visible(db, answer.question_id)
    course = courses_service.get_course(db, question.course_id)
    if course is None:
        raise courses_domain.CourseNotFoundError()
    domain.ensure_can_certify(course.teacher_id, user_id)
    repository.set_certified_flag(db, answer_id, certified)
    db.commit()
    return {"answer_id": answer.id, "certified_by_teacher": certified}


# ---------- 评论（T-06，学生端接口文档 §5） ----------

COMMENT_TARGET_QUESTION = "question"
COMMENT_TARGET_ANSWER = "answer"


def _resolve_comment_target(
    db: Session, target: str, target_id: int
) -> tuple[int | None, int | None]:
    """评论目标可见性（404）：软删问题/回答下不可评论也不可见（E-10）。

    返回挂载列（question_id, answer_id），二选一。
    """
    if target == COMMENT_TARGET_QUESTION:
        question = repository.get_by_id(db, target_id)
        if question is None or not domain.is_visible(question.deleted_at, question.is_hidden):
            raise domain.QuestionNotFoundError()
        return target_id, None
    answer = repository.get_answer_by_id(db, target_id)
    if answer is None or not domain.is_visible(answer.deleted_at, answer.is_hidden):
        raise domain.AnswerNotFoundError()
    # 父问题软删 → 回答整体不可达（E-10），评论与评论列表一并 404
    _ensure_question_visible(db, answer.question_id)
    return None, target_id


def prepare_comment(
    db: Session, user_id: int, target: str, target_id: int, body: str,
    parent_id: int | None,
) -> PreparedCommentData:
    """发表评论/二级回复（US-05）：非空（E-01）→ 清洗截断（E-02/X-03）→
    父评论校验（400：不存在/已删/跨目标/超二级）→ 入库。

    评论资格：任何登录用户可评论可见目标；被封禁用户已被 get_current_user 拦截（E-07）。
    """
    question_id, answer_id = _resolve_comment_target(db, target, target_id)
    domain.ensure_not_blank(body)
    truncated = len(body) > domain.COMMENT_MAX_LEN
    parent_author_id = None
    if parent_id is not None:
        parent = repository.get_comment_by_id(db, parent_id)
        if parent is None or not domain.is_visible(parent.deleted_at, parent.is_hidden):
            raise domain.CommentParentInvalidError()
        domain.ensure_parent_in_same_target(
            parent.question_id, parent.answer_id, question_id, answer_id
        )
        domain.ensure_top_level_parent(parent.parent_id)
        parent_author_id = parent.author_id
    comment = repository.create_comment(
        db,
        body=domain.sanitize_and_truncate_comment(body),
        author_id=user_id,
        question_id=question_id,
        answer_id=answer_id,
        parent_id=parent_id,
    )
    target_data = (repository.get_by_id(db, target_id) if question_id is not None
                   else repository.get_answer_by_id(db, target_id))
    return PreparedCommentData(
        comment=comment, truncated=truncated,
        question_id=target_id if question_id is not None else target_data.question_id,
        target_author_id=target_data.author_id, parent_author_id=parent_author_id,
    )


def list_comments(
    db: Session, target: str, target_id: int, page: int, page_size: int
) -> tuple[list[CommentListItemResponse], int]:
    """评论列表（US-05）：顶级评论分页、二级回复全量归组 replies；软删不可见（E-10）。

    作者名一次批量取（顶评 + 回复合并去重），避免 N+1。
    """
    question_id, answer_id = _resolve_comment_target(db, target, target_id)
    tops, total = repository.list_top_comments(
        db, question_id, answer_id, page, page_size
    )
    replies = repository.list_replies_by_parent_ids(db, [t.id for t in tops])
    author_ids = {c.author_id for c in tops} | {r.author_id for r in replies}
    names = identity_service.get_usernames_by_ids(db, list(author_ids))
    grouped: dict[int, list[CommentReplyResponse]] = {}
    for r in replies:
        grouped.setdefault(r.parent_id, []).append(
            CommentReplyResponse(
                id=r.id,
                author=names.get(r.author_id, ""),
                body=r.body,
                parent_id=r.parent_id,
                created_at=r.created_at,
            )
        )
    items = [
        CommentListItemResponse(
            id=t.id,
            author=names.get(t.author_id, ""),
            body=t.body,
            created_at=t.created_at,
            replies=grouped.get(t.id, []),
        )
        for t in tops
    ]
    return items, total


def delete_comment(db: Session, user_role: str, user_id: int, comment_id: int) -> None:
    """软删除评论：作者或管理员（US-05/E-10），行保留供管理员追溯。

    顶级评论被删时同一事务级联软删其直接回复（二级限制下仅一层），
    避免回复孤儿化——实现补充语义（接口文档未定案），见审查记录决策。
    """
    comment = repository.get_comment_by_id(db, comment_id)
    if comment is None or not domain.is_visible(comment.deleted_at, comment.is_hidden):
        raise domain.CommentNotFoundError()
    domain.ensure_comment_can_delete(user_role, comment.author_id, user_id)
    if comment.parent_id is None:
        repository.soft_delete_replies(db, comment.id)
    repository.soft_delete_comment(db, comment_id)
    db.commit()


# ---------- 标签（T-07，学生端接口文档 §3） ----------


def list_tags(db: Session, keyword: str | None, hot: bool) -> list[TagResponse]:
    """标签列表（US-03）：keyword 模糊筛名；hot=true 按绑定数降序取前 N（domain 常量）。"""
    return repository.list_tags(db, keyword, hot)


def get_tag_detail(db: Session, tag_id: int) -> TagResponse:
    tag = repository.get_tag_detail(db, tag_id)
    if tag is None:
        raise domain.TagDetailNotFoundError()
    return tag


def bind_question_tags(
    db: Session, user_id: int, question_id: int, tag_refs: list[int | str]
) -> list[TagBrief]:
    """问题绑定标签（US-03/E-03，增量追加）：问题可见（404）→ 仅作者（403）→
    入参归一（400：id 不存在/空名）→ 判重（E-03：与既有重复、同请求重复）→
    上限（QUESTION_MAX_TAGS）→ 同一事务写入并返回绑定后的完整标签集。
    """
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at, question.is_hidden):
        raise domain.QuestionNotFoundError()
    domain.ensure_can_bind_tags(question.author_id, user_id)
    resolved = _resolve_tag_refs(db, tag_refs)
    bound = repository.get_bound_tag_ids(db, question.id)
    domain.ensure_not_already_bound(bound, resolved)
    domain.ensure_tag_count_within_limit(len(bound), len(resolved))
    repository.bind_tags(db, question.id, resolved)
    db.commit()
    return repository.get_tags_by_question_ids(db, [question.id]).get(question.id, [])


def list_related_questions(db: Session, question_id: int) -> list[QuestionListItemResponse]:
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at, question.is_hidden):
        raise domain.QuestionNotFoundError()
    return assemble_question_cards(db, repository.list_related_questions(db, question_id))


def count_questions_by_course_ids(db: Session, course_ids: list[int]) -> dict[int, int]:
    return repository.count_questions_by_course_ids(db, course_ids)


def list_course_tags(db: Session, course_id: int) -> list[TagResponse]:
    return repository.list_course_tags(db, course_id)


def list_course_activity_batch(
    db: Session, course_id: int, last_count: int | None, last_user_id: int | None,
) -> list[tuple[int, int]]:
    return repository.list_course_activity_batch(db, course_id, last_count, last_user_id)


# ---------- 治理处置（US-14，governance 模块专用） ----------
#
# 与公开 service 用例的区别：不带用户鉴权（人工审核已在 governance 入口完成）、
# 不自行 commit（只 flush），事务由 governance service 统一提交，保证工单留痕
# 与内容状态同生共死。动作与目标类型的匹配校验在 governance/domain 完成。


def probe_moderation_target(
    db: Session, target_type: str, target_id: int
) -> str:
    """处置前探针：返回 ready / missing / deleted / hidden。"""
    row = repository.moderation_get_target(db, target_type, target_id)
    if row is None:
        return domain.MOD_TARGET_MISSING
    if row.deleted_at is not None:
        return domain.MOD_TARGET_DELETED
    if row.is_hidden:
        return domain.MOD_TARGET_HIDDEN
    return domain.MOD_TARGET_READY


def moderation_get_snapshot(
    db: Session, target_type: str, target_id: int, *, for_update: bool = False,
) -> dict:
    """审批版本使用目标自身业务字段；排除浏览/投票计数，快照不对外输出。"""
    row = repository.moderation_get_target(db, target_type, target_id, for_update=for_update)
    if row is None:
        return {"state": "missing"}
    state = "deleted" if row.deleted_at is not None else "hidden" if row.is_hidden else "ready"
    fields = (
        "title", "body", "author_id", "course_id", "question_id", "answer_id", "parent_id",
        "status", "is_hidden", "deleted_at",
    )
    return {"state": state, **{field: getattr(row, field, None) for field in fields}}


def get_content_author(
    db: Session, target_type: str, target_id: int
) -> int | None:
    """跨模块公开函数（D-5）：治理目标作者 ID（含已隐藏/已软删，供申诉归属判定）。

    与 moderation_get_content 不同：不做可见性过滤——被处置内容的作者
    恰恰需要据此发起申诉；目标不存在返回 None。
    """
    row = repository.moderation_get_target(db, target_type, target_id)
    return row.author_id if row is not None else None


def moderation_restore_visible(
    db: Session, target_type: str, target_id: int
) -> None:
    """跨模块公开函数（D-5）：恢复隐藏内容可见（申诉复核撤销 hide，T-15-A）。"""
    repository.moderation_restore_visible(db, target_type, target_id)


def moderation_restore_deleted(
    db: Session, target_type: str, target_id: int
) -> None:
    """跨模块公开函数（D-5）：恢复软删内容（申诉复核撤销 delete，T-15-A）。"""
    repository.moderation_restore_deleted(db, target_type, target_id)


def list_patrol_contents(
    db: Session, created_from: datetime, limit: int
) -> list[PatrolContentItem]:
    """跨模块公开函数（D-5）：全站时间窗内新内容清单（US-13 静默巡检，T-15-B）。

    只读；软删/隐藏排除；不含隐私字段。
    """
    return repository.list_patrol_contents(db, created_from, limit)


def _ensure_ancestors_visible(
    db: Session, target_type: str, target_id: int
) -> None:
    """后代正文随祖先可见性（US-13）：沿 父评论→回答→问题 逐级探针，任一不可见即 404。"""
    seen: set[tuple[str, int]] = {(target_type, target_id)}
    current: tuple[str, int] | None = (target_type, target_id)
    while current is not None:
        kind, cid = current
        row = repository.moderation_get_target(db, kind, cid)
        if row is None:
            return
        nxt: tuple[str, int] | None = None
        if kind == "comment":
            if row.parent_id is not None:
                nxt = ("comment", row.parent_id)
            elif row.answer_id is not None:
                nxt = ("answer", row.answer_id)
            elif row.question_id is not None:
                nxt = ("question", row.question_id)
        elif kind == "answer":
            nxt = ("question", row.question_id)
        if nxt is None or nxt in seen:
            return
        seen.add(nxt)
        if probe_moderation_target(db, nxt[0], nxt[1]) != domain.MOD_TARGET_READY:
            raise domain.ModerationTargetUnavailableError()
        current = nxt


def moderation_get_content(
    db: Session, target_type: str, target_id: int
) -> ModerationContentData:
    """Agent 风险扫描用正文：仅返回可见目标，自身或祖先不可见统一 404。"""
    state = probe_moderation_target(db, target_type, target_id)
    if state != domain.MOD_TARGET_READY:
        raise domain.ModerationTargetUnavailableError()
    _ensure_ancestors_visible(db, target_type, target_id)
    content = repository.moderation_get_content(db, target_type, target_id)
    if content is None:
        raise domain.ModerationTargetUnavailableError()
    return content


def moderation_hide(db: Session, target_type: str, target_id: int) -> None:
    """临时隐藏（is_hidden 置位），只 flush。"""
    repository.moderation_set_hidden(db, target_type, target_id)


def moderation_soft_delete(db: Session, target_type: str, target_id: int) -> None:
    """软删除（deleted_at 落痕），只 flush；回答采纳与评论回复级联复用既有规则。"""
    if target_type == "answer":
        # 被采纳回答软删时同步撤采纳，避免悬空 accepted_answer_id（复用 T-05 规则）
        question, answer = repository.lock_answer_context(db, target_id)
        if (
            question is not None
            and answer is not None
            and question.accepted_answer_id == target_id
        ):
            repository.unaccept_answer(db, answer.question_id)
    elif target_type == "comment":
        comment = repository.get_comment_by_id(db, target_id)
        if comment is not None and comment.parent_id is None:
            # 顶级评论删除时级联软删直接回复，与作者自删口径一致
            repository.soft_delete_replies(db, target_id)
    repository.moderation_set_deleted(db, target_type, target_id)
