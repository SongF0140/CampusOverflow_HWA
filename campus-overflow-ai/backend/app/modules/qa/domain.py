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
