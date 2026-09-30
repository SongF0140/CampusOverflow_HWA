# qa 数据访问：查询与写入函数，仅被本模块 service 调用（架构规则 2.3-3）
# 分层基线 D-2：本文件是模块内唯一允许 import models 的地方；出参一律 schemas。
# 事务约定 D-8：本层只 flush 不 commit，事务边界（commit）在 service 用例层。
from datetime import datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.qa import domain
from app.modules.qa.models import Answer, Question
from app.modules.qa.schemas import AnswerResponse, QuestionResponse

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
    question = db.get(Question, question_id)
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
    sort: str, unresolved: bool, keyword: str | None,
) -> tuple[list[QuestionResponse], int]:
    """分页列问题：软删不可见（E-10）；支持课程/未解决/关键词筛选与最新/热度排序。

    hot 暂按浏览数排序（投票分随 T-08 回填后改为 vote_score）。
    """
    query = db.query(Question).filter(Question.deleted_at.is_(None))
    if course_id is not None:
        query = query.filter(Question.course_id == course_id)
    if unresolved:
        query = query.filter(Question.status == domain.STATUS_PUBLISHED)
    if keyword:
        like = f"%{keyword}%"
        query = query.filter(or_(Question.title.like(like), Question.body.like(like)))
    total = query.count()
    if sort == SORT_HOT:
        query = query.order_by(Question.view_count.desc(), Question.created_at.desc())
    else:
        query = query.order_by(Question.created_at.desc())
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
    answer = db.get(Answer, answer_id)
    if answer is None:
        raise domain.AnswerNotFoundError()
    answer.deleted_at = datetime.now()
    db.flush()


def list_answers(
    db: Session, question_id: int, accepted_answer_id: int | None,
    sort: str, page: int, page_size: int,
) -> tuple[list[AnswerResponse], int]:
    """分页列某问题的可见回答（E-10）；accepted 排序将被采纳回答置顶突出展示。

    votes 暂与 latest 同按创建时间倒序（投票分随 T-08 回填后改为 vote_score 降序）。
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

    幂等性之外的竞争由 questions.accepted_answer_id 唯一约束兜底（E-05）。
    """
    question = db.get(Question, question_id)
    if question is None:
        raise domain.QuestionNotFoundError()
    question.accepted_answer_id = answer_id
    question.status = domain.STATUS_RESOLVED
    db.flush()


def unaccept_answer(db: Session, question_id: int) -> None:
    """撤销采纳：清空引用并把问题状态回退为 published（已采纳回答被软删时级联）。"""
    question = db.get(Question, question_id)
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
