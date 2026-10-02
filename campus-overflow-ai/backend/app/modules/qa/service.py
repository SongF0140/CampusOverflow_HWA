# qa 业务层：用例编排、事务边界与授权决策
# 分层基线 D-1/D-2/D-3：规则在 domain.py，ORM 留在 repository，本层不碰 HTTP 协议。
# 签名约定 D-7：入参只收基本类型；事务约定 D-8：写用例末尾显式 db.commit()。
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.courses import domain as courses_domain
from app.modules.courses import service as courses_service
from app.modules.identity import service as identity_service
from app.modules.qa import domain, repository
from app.modules.qa.schemas import (
    AnswerListItemResponse,
    AnswerResponse,
    CommentListItemResponse,
    CommentReplyResponse,
    CommentResponse,
    QuestionDetailResponse,
    QuestionListItemResponse,
    QuestionResponse,
)


def _is_truncated(title: str, body: str) -> bool:
    """E-02 提示标志：原始输入超限即提示（清洗只会缩短，不影响判断方向）。"""
    return len(title.strip()) > domain.TITLE_MAX_LEN or len(body) > domain.BODY_MAX_LEN


def publish_question(
    db: Session, user_id: int, title: str, body: str, course_id: int
) -> tuple[QuestionResponse, bool]:
    """发布问题：非空校验（E-01）→ 清洗截断（E-02/X-03）→ 课程校验（404）→
    发布资格（403：负责教师天然可发，其余须已加入）→ 入库。
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
    db.commit()
    # TODO(agent): QuestionPosted 事件发布点（治理订阅，一期仅注释，见架构说明 4.A）
    return question, truncated


def list_questions(
    db: Session, page: int, page_size: int, course_id: int | None,
    sort: str, unresolved: bool, keyword: str | None,
) -> tuple[list[QuestionListItemResponse], int]:
    """问题列表：作者名批量取、回答数一次 GROUP BY 批量统计（避免 N+1）。"""
    questions, total = repository.list_questions(
        db, page, page_size, course_id, sort, unresolved, keyword
    )
    names = identity_service.get_usernames_by_ids(db, [q.author_id for q in questions])
    counts = repository.count_answers_by_question_ids(db, [q.id for q in questions])
    items = [
        QuestionListItemResponse(
            id=q.id,
            title=q.title,
            course_id=q.course_id,
            author=names.get(q.author_id, ""),
            status=q.status,
            answer_count=counts.get(q.id, 0),
            view_count=q.view_count,
            has_accepted=q.accepted_answer_id is not None,
            created_at=q.created_at,
        )
        for q in questions
    ]
    return items, total


def get_question_detail(db: Session, question_id: int) -> QuestionDetailResponse:
    """问题详情：软删不可见（E-10）；浏览数原子 +1；回答经 GET /questions/{id}/answers 分页获取。"""
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at):
        raise domain.QuestionNotFoundError()
    names = identity_service.get_usernames_by_ids(db, [question.author_id])
    repository.increment_view(db, question_id)
    db.commit()
    return QuestionDetailResponse(
        id=question.id,
        title=question.title,
        body=question.body,
        course_id=question.course_id,
        author=names.get(question.author_id, ""),
        status=question.status,
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
    if question is None or not domain.is_visible(question.deleted_at):
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
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at):
        raise domain.QuestionNotFoundError()
    domain.ensure_can_delete(user_role, question.author_id, user_id)
    repository.soft_delete(db, question_id)
    db.commit()


# ---------- 回答与采纳（T-05） ----------


def publish_answer(
    db: Session, user_id: int, question_id: int, body: str
) -> tuple[AnswerResponse, bool]:
    """发布回答：问题可见（404）→ 非空（E-01）→ 清洗截断（E-02/X-03）→ 入库。

    回答资格：任何登录用户可回答可见问题（学生端接口文档 §4 未设课程成员限制）；
    被封禁用户已被 get_current_user 统一拦截（E-07）。
    """
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at):
        raise domain.QuestionNotFoundError()
    domain.ensure_not_blank(body)
    truncated = len(body) > domain.BODY_MAX_LEN
    answer = repository.create_answer(
        db, question_id, user_id, domain.sanitize_and_truncate_body(body)
    )
    db.commit()
    # TODO(agent): AnswerPosted 事件发布点（治理订阅，一期仅注释，见架构说明 4.C）
    return answer, truncated


def list_answers(
    db: Session, question_id: int, sort: str, page: int, page_size: int
) -> tuple[list[AnswerListItemResponse], int]:
    """回答列表：问题软删则 404；is_accepted 由问题采纳引用判定（US-06）。"""
    question = repository.get_by_id(db, question_id)
    if question is None or not domain.is_visible(question.deleted_at):
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
            is_accepted=a.id == question.accepted_answer_id,
            recommended_by_assistant=a.recommended_by_assistant,
            certified_by_teacher=a.certified_by_teacher,
            created_at=a.created_at,
        )
        for a in answers
    ]
    return items, total


def update_answer(
    db: Session, user_id: int, answer_id: int, body: str
) -> tuple[AnswerResponse, bool]:
    """编辑回答：仅作者；非空（E-01）与清洗截断（E-02/X-03）同发布。"""
    answer = repository.get_answer_by_id(db, answer_id)
    if answer is None or not domain.is_visible(answer.deleted_at):
        raise domain.AnswerNotFoundError()
    domain.ensure_answer_can_edit(answer.author_id, user_id)
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
    """
    answer = repository.get_answer_by_id(db, answer_id)
    if answer is None or not domain.is_visible(answer.deleted_at):
        raise domain.AnswerNotFoundError()
    domain.ensure_answer_can_delete(user_role, answer.author_id, user_id)
    question = repository.get_by_id(db, answer.question_id)
    if question is not None and question.accepted_answer_id == answer_id:
        repository.unaccept_answer(db, answer.question_id)
    repository.soft_delete_answer(db, answer_id)
    db.commit()


def accept_answer(db: Session, user_id: int, answer_id: int) -> dict:
    """采纳回答（US-06）：仅提问者（E-06）→ 无已采纳（E-05）→ 同一事务写入。

    架构说明 4.B 的三步事务中，声誉与通知两步依赖 interaction 模块（T-08/T-10），
    本期仅落问题侧写入并留 TODO 钩子；E-05 并发竞争由采纳列唯一约束兜底。
    """
    answer = repository.get_answer_by_id(db, answer_id)
    if answer is None or not domain.is_visible(answer.deleted_at):
        raise domain.AnswerNotFoundError()
    question = repository.get_by_id(db, answer.question_id)
    if question is None or not domain.is_visible(question.deleted_at):
        raise domain.QuestionNotFoundError()
    domain.ensure_can_accept(question.author_id, user_id)
    domain.ensure_not_accepted(question.accepted_answer_id)
    repository.accept_answer(db, question.id, answer.id)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise domain.AlreadyAcceptedError() from None
    # TODO(T-08): interaction.service.grant_reputation(回答者, +15, "accept", answer_id)
    # TODO(T-10): interaction.service.notify(回答者, "accepted", answer_id)
    return {"accepted": True, "question_status": domain.STATUS_RESOLVED}


def recommend_answer(db: Session, answer_id: int, recommended: bool) -> dict:
    """助教推荐标记（US-20/E-13）：能力位由 require_graduate_assistant 在路由层把关。"""
    answer = repository.get_answer_by_id(db, answer_id)
    if answer is None or not domain.is_visible(answer.deleted_at):
        raise domain.AnswerNotFoundError()
    repository.set_recommend_flag(db, answer_id, recommended)
    db.commit()
    return {"answer_id": answer.id, "recommended_by_assistant": recommended}


def certify_answer(db: Session, user_id: int, answer_id: int, certified: bool) -> dict:
    """优质内容认证（D9 定案）：仅回答所在课程的负责教师，POST 置位 / DELETE 取消。"""
    answer = repository.get_answer_by_id(db, answer_id)
    if answer is None or not domain.is_visible(answer.deleted_at):
        raise domain.AnswerNotFoundError()
    question = repository.get_by_id(db, answer.question_id)
    if question is None or not domain.is_visible(question.deleted_at):
        raise domain.QuestionNotFoundError()
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
        if question is None or not domain.is_visible(question.deleted_at):
            raise domain.QuestionNotFoundError()
        return target_id, None
    answer = repository.get_answer_by_id(db, target_id)
    if answer is None or not domain.is_visible(answer.deleted_at):
        raise domain.AnswerNotFoundError()
    return None, target_id


def publish_comment(
    db: Session, user_id: int, target: str, target_id: int, body: str,
    parent_id: int | None,
) -> tuple[CommentResponse, bool]:
    """发表评论/二级回复（US-05）：非空（E-01）→ 清洗截断（E-02/X-03）→
    父评论校验（400：不存在/已删/跨目标/超二级）→ 入库。

    评论资格：任何登录用户可评论可见目标；被封禁用户已被 get_current_user 拦截（E-07）。
    """
    question_id, answer_id = _resolve_comment_target(db, target, target_id)
    domain.ensure_not_blank(body)
    truncated = len(body) > domain.COMMENT_MAX_LEN
    if parent_id is not None:
        parent = repository.get_comment_by_id(db, parent_id)
        if parent is None or not domain.is_visible(parent.deleted_at):
            raise domain.CommentParentInvalidError()
        domain.ensure_parent_in_same_target(
            parent.question_id, parent.answer_id, question_id, answer_id
        )
        domain.ensure_top_level_parent(parent.parent_id)
    comment = repository.create_comment(
        db,
        body=domain.sanitize_and_truncate_comment(body),
        author_id=user_id,
        question_id=question_id,
        answer_id=answer_id,
        parent_id=parent_id,
    )
    db.commit()
    # TODO(T-10): interaction.service.notify(被评论者, "commented", comment_id)
    #   被评论者 = 目标作者；带 parent_id 时被回复者 = 父评论作者（US-15，随 T-10 回填）
    return comment, truncated


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
    if comment is None or not domain.is_visible(comment.deleted_at):
        raise domain.CommentNotFoundError()
    domain.ensure_comment_can_delete(user_role, comment.author_id, user_id)
    if comment.parent_id is None:
        repository.soft_delete_replies(db, comment.id)
    repository.soft_delete_comment(db, comment_id)
    db.commit()
