"""周报 CSV 导出（P3）：站内交付补充；不含学生身份、会话 ID、私人记忆与原始聊天。"""

import csv
import io
from datetime import datetime, time, timedelta

from sqlalchemy.orm import Session

from app.modules.courses import service
from app.modules.courses.schemas import WeeklyReportResponse
from app.modules.qa import service as qa_service
from app.modules.qa.schemas import RecentQuestionContent

CSV_HEADER = ("课程", "周次", "类型", "名称", "次数", "标签", "公开题链接", "建议")
QUESTION_LIMIT = 200


def _week_bounds(report: WeeklyReportResponse) -> tuple[datetime, datetime]:
    """周报日期按库内 naive 时间口径解释；结束日包含全天。"""
    start = datetime.combine(report.week_start, time.min)
    end = datetime.combine(report.week_end + timedelta(days=1), time.min)
    return start, end


def _cell(value: object) -> object:
    """防 CSV 公式注入：不可信文本以 = + - @ 开头时加单引号前缀。"""
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return f"'{value}"
    return value


def _tag_stats(
    questions: list[RecentQuestionContent],
) -> list[tuple[str, int, list[int]]]:
    """按标签聚合不同问题数；同一问题重复标签只计一次。"""
    stats: dict[int, tuple[str, set[int]]] = {}
    for question in questions:
        for tag in question.tags or []:
            name, ids = stats.get(tag.id, (tag.name, set()))
            ids.add(question.id)
            stats[tag.id] = (name, ids)
    return [
        (name, len(ids), sorted(ids))
        for name, ids in stats.values()
    ]


def build_weekly_report_csv(
    db: Session, user_id: int, course_id: int, report_id: int
) -> tuple[str, str]:
    """生成周报 CSV（含 BOM）；权限与周报详情接口一致（负责教师或管理员）。"""
    report = service.get_weekly_report(db, user_id, course_id, report_id)
    course = service.get_course(db, course_id)
    course_name = course.name if course is not None else f"课程 {course_id}"
    week = f"{report.week_start.isoformat()}~{report.week_end.isoformat()}"
    start, end = _week_bounds(report)
    questions = qa_service.list_recent_question_contents(
        db, course_id, start, QUESTION_LIMIT, created_before=end,
    )

    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(CSV_HEADER)
    for entry in report.heatmap:
        writer.writerow((
            _cell(course_name), week, "知识点", _cell(entry.node_name),
            entry.question_count, "", "", "",
        ))
    for topic in report.uncovered_topics:
        writer.writerow((
            _cell(course_name), week, "未覆盖主题", _cell(topic.topic),
            topic.question_count, "", "", _cell(topic.suggestion),
        ))
    for name, count, ids in _tag_stats(questions):
        links = " ".join(f"/questions/{question_id}" for question_id in ids[:5])
        writer.writerow((
            _cell(course_name), week, "高频标签", _cell(name), count,
            _cell(name), links, "",
        ))
    for question in questions:
        tags = "、".join(tag.name for tag in question.tags or [])
        writer.writerow((
            _cell(course_name), week, "公开问题", _cell(question.title), "",
            _cell(tags), f"/questions/{question.id}", "",
        ))
    filename = f"weekly-report-{course_id}-{report.week_start.isoformat()}.csv"
    return filename, "\ufeff" + buffer.getvalue()
