"""教师名单确认与原子写入；模型只能申请，不能直接确认。"""
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.courses import service as courses_service
from app.modules.governance import domain, repository
from app.modules.governance.schemas_roles import ClassChangeOut
from app.modules.identity import service as identity_service


def _output(row: ClassChangeOut) -> dict:
    return {**row.model_dump(exclude={"snapshot", "teacher_id"}), **row.snapshot,
            "executed": row.status == "executed", "requires_confirmation": row.status == "pending"}


def propose(
    db: Session, teacher_id: int, request_id: str, course_id: int,
    student_ids: list[int], action: str, trace_id: str,
) -> dict:
    snapshot = courses_service.teacher_membership_snapshot(db, teacher_id, course_id, student_ids)
    existing = repository.get_class_change(db, request_id)
    if existing:
        frozen_ids = [item["user_id"] for item in existing.snapshot["students"]]
        if (existing.teacher_id, existing.course_id, existing.action, frozen_ids) != (
            teacher_id, course_id, action, student_ids,
        ):
            raise domain.CaseTargetNotReadyError("名单申请标识或参数已变化")
        return _output(existing)
    try:
        run_id = f"class-{request_id}"
        repository.create_run(db, "class_change_proposal", trace_id, run_id,
                              "提出班级名单变更，等待负责教师确认", user_id=teacher_id)
        row = repository.create_class_change(
            db, request_id=request_id, teacher_id=teacher_id, course_id=course_id, action=action,
            snapshot=snapshot, trace_id=trace_id, status="pending",
            expires_at=(datetime.now(UTC) + timedelta(days=7)).replace(tzinfo=None),
        )
        repository.update_run(db, run_id, "succeeded", "名单申请已保存，尚未执行", None)
        db.commit()
        return _output(row)
    except IntegrityError:
        db.rollback()
        if repository.get_class_change(db, request_id):
            return propose(db, teacher_id, request_id, course_id, student_ids, action, trace_id)
        raise
    except Exception:
        db.rollback()
        raise


def operate(db: Session, teacher_id: int, request_id: str, operation: str) -> dict:
    row = repository.get_class_change(db, request_id)
    if row is None:
        raise domain.DecisionNotFoundError()
    ids = [item["user_id"] for item in row.snapshot["students"]]
    courses_service.teacher_membership_snapshot(db, teacher_id, row.course_id, [])
    if row.teacher_id != teacher_id and identity_service.get_by_id(db, teacher_id).role != "admin":
        raise domain.CaseActionForbiddenError("仅申请的负责教师或管理员可确认")
    if row.status != "pending":
        return _output(row)
    if operation == "read" and row.expires_at.replace(tzinfo=UTC) > datetime.now(UTC):
        return _output(row)
    try:
        if row.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC):
            state = "expired"
        elif operation == "cancel":
            state = "cancelled"
        else:
            current = courses_service.teacher_membership_snapshot(
                db, teacher_id, row.course_id, ids,
            )
            if current != row.snapshot:
                raise domain.CaseTargetNotReadyError("班级或学生状态已变化，请重新生成变更清单")
            run_id = f"class-apply-{request_id}"
            repository.create_run(db, "class_change_execute", row.trace_id, run_id,
                                  "负责教师明确确认班级名单变更", user_id=teacher_id)
            courses_service.prepare_teacher_memberships(
                db, teacher_id, row.course_id, ids, row.action,
            )
            repository.update_run(db, run_id, "succeeded", "名单变更已执行", None)
            state = "executed"
        result = repository.finish_class_change(db, request_id, state)
        db.commit()
        return _output(result)
    except Exception:
        db.rollback()
        raise
