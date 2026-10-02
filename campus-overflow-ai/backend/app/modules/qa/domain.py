# qa 领域规则：问题状态机、内容不变量、清洗与领域异常
# 铁律：零框架依赖——本文件不得 import fastapi / sqlalchemy / pydantic，可直接单测。
# bleach 是纯文本处理库（无 I/O），承担 X-03 清洗规则，属领域规则范畴。
import bleach

from app.core.domain_error import DomainError

# ---------- 领域常量 ----------

ROLE_ADMIN = "admin"

# 问题状态：published 正常展示 / resolved 已被采纳解决（T-05 采纳时迁移）
STATUS_PUBLISHED = "published"
STATUS_RESOLVED = "resolved"

# 内容长度上限（E-02：超长截断并提示；plan 未落定，T-04 定案，审查可调）
TITLE_MAX_LEN = 100
BODY_MAX_LEN = 20000

# X-03 清洗策略：剥离全部 HTML 标签与属性——存储的是 Markdown 源文本，
# 标签本就不该执行；富文本渲染由第二阶段前端负责
_CLEANER = bleach.Cleaner(tags=[], attributes={}, strip=True, strip_comments=True)


# ---------- 领域异常（http_status 由 core/errors.py 统一映射） ----------


class QuestionNotFoundError(DomainError):
    """问题不存在或已删除。"""

    http_status = 404


class EmptyContentError(DomainError):
    """标题或正文为空，不能提交（E-01）。"""

    http_status = 400


class QuestionEditDeniedError(DomainError):
    """仅问题作者可编辑问题。"""

    http_status = 403


class QuestionDeleteDeniedError(DomainError):
    """仅问题作者与管理员可删除问题。"""

    http_status = 403


class CoursePostDeniedError(DomainError):
    """未加入该课程，不能在课程内发布问题。"""

    http_status = 403


class AnswerNotFoundError(DomainError):
    """回答不存在或已删除。"""

    http_status = 404


class AnswerEditDeniedError(DomainError):
    """仅回答作者可编辑回答。"""

    http_status = 403


class AnswerDeleteDeniedError(DomainError):
    """仅回答作者与管理员可删除回答。"""

    http_status = 403


class AcceptDeniedError(DomainError):
    """仅提问者可以采纳回答。"""

    http_status = 403


class AlreadyAcceptedError(DomainError):
    """该问题已有采纳答案，不能再次采纳（E-05）。"""

    http_status = 400


class CertifyDeniedError(DomainError):
    """仅回答所在课程的负责教师可认证优质内容（E-06）。"""

    http_status = 403


# ---------- 不变量与规则 ----------


def ensure_not_blank(value: str) -> None:
    """不变量：单个内容字段去除首尾空白后不得为空（E-01，供部分更新复用）。"""
    if not value.strip():
        raise EmptyContentError()


def ensure_not_empty(title: str, body: str) -> None:
    """不变量：标题与正文均不得为空（E-01）。"""
    ensure_not_blank(title)
    ensure_not_blank(body)


def ensure_can_edit(author_id: int, user_id: int) -> None:
    """不变量：仅问题作者可编辑。"""
    if author_id != user_id:
        raise QuestionEditDeniedError()


def ensure_can_delete(role: str, author_id: int, user_id: int) -> None:
    """不变量：作者或管理员可软删除（E-10）。"""
    if role != ROLE_ADMIN and author_id != user_id:
        raise QuestionDeleteDeniedError()


def truncate_title(title: str) -> str:
    """标题超长截断至 TITLE_MAX_LEN（E-02）。"""
    return title.strip()[:TITLE_MAX_LEN]


def sanitize_and_truncate_body(body: str) -> str:
    """正文先剥离脚本与 HTML 标签（X-03）再截断至 BODY_MAX_LEN（E-02）。

    先清洗后截断：避免截断点落在标签中间留下残缺标记。
    """
    return _CLEANER.clean(body)[:BODY_MAX_LEN]


def is_visible(deleted_at: object | None) -> bool:
    """可见性规则：软删除（deleted_at 非空）后普通列表与详情不可见（E-10）。"""
    return deleted_at is None


# ---------- 回答侧规则（T-05） ----------


def ensure_answer_can_edit(author_id: int, user_id: int) -> None:
    """不变量：仅回答作者可编辑回答。"""
    if author_id != user_id:
        raise AnswerEditDeniedError()


def ensure_answer_can_delete(role: str, author_id: int, user_id: int) -> None:
    """不变量：回答作者或管理员可软删除（E-10）。"""
    if role != ROLE_ADMIN and author_id != user_id:
        raise AnswerDeleteDeniedError()


def ensure_can_accept(question_author_id: int, user_id: int) -> None:
    """不变量：仅提问者可采纳回答（US-06 / E-06）。"""
    if question_author_id != user_id:
        raise AcceptDeniedError()


def ensure_not_accepted(accepted_answer_id: int | None) -> None:
    """不变量：一个问题最多一个采纳答案，已有采纳则拒绝（E-05）。"""
    if accepted_answer_id is not None:
        raise AlreadyAcceptedError()


def ensure_can_certify(course_teacher_id: int, user_id: int) -> None:
    """不变量：仅回答所在课程的负责教师可认证优质内容（D9 定案 / E-06）。

    管理员也不放行：对照表 D9 定案 require_roles(teacher) 且限定本人任教课程。
    """
    if course_teacher_id != user_id:
        raise CertifyDeniedError()


# ---------- 评论侧规则（T-06） ----------

# 评论内容上限（E-02：超长截断并提示；评论为短文本，T-06 定案 1000 字，审查可调）
COMMENT_MAX_LEN = 1000


class CommentNotFoundError(DomainError):
    """评论不存在或已删除。"""

    http_status = 404


class CommentDeleteDeniedError(DomainError):
    """仅评论作者与管理员可删除评论。"""

    http_status = 403


class CommentParentInvalidError(DomainError):
    """回复目标非法：父评论不存在、已删除、跨目标或超过二级（US-05）。"""

    http_status = 400


def ensure_comment_can_delete(role: str, author_id: int, user_id: int) -> None:
    """不变量：评论作者或管理员可删除（US-05：作者删自己，管理员删违规）。"""
    if role != ROLE_ADMIN and author_id != user_id:
        raise CommentDeleteDeniedError()


def sanitize_and_truncate_comment(body: str) -> str:
    """评论正文先清洗（X-03，复用同一剥离策略）再截断至 COMMENT_MAX_LEN（E-02）。"""
    return _CLEANER.clean(body)[:COMMENT_MAX_LEN]


def ensure_parent_in_same_target(
    parent_question_id: int | None,
    parent_answer_id: int | None,
    question_id: int | None,
    answer_id: int | None,
) -> None:
    """不变量：回复的父评论必须挂在同一目标（问题/回答）下。"""
    if parent_question_id != question_id or parent_answer_id != answer_id:
        raise CommentParentInvalidError()


def ensure_top_level_parent(parent_parent_id: int | None) -> None:
    """不变量：仅支持二级回复——被回复的父评论本身必须是顶级评论（US-05）。

    例：评论 A（顶级）→ 回复 B（parent=A）合法；再回复 C（parent=B）拒绝。
    """
    if parent_parent_id is not None:
        raise CommentParentInvalidError()
