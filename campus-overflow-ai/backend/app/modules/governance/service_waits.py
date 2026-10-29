"""一次性反馈续接；只读后端处置结果，绝不调用真实处置。"""
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.modules.governance import domain, repository


def read_or_resume(db: Session, user_id: int, request_id: str, operation: str) -> dict:
    wait = repository.get_approval_wait(db, request_id)
    if wait is None or wait.user_id != user_id:
        raise domain.DecisionNotFoundError()
    case = repository.get_case_by_id(db, wait.case_id, for_update=True)
    if case is None or case.agent_run_id != f"approval-{request_id}":
        raise domain.CaseTargetNotReadyError("审批关联已失效")
    state = wait.state
    if state == "waiting":
        if operation == "cancel":
            state = "cancelled"
        elif wait.expires_at and wait.expires_at.replace(tzinfo=UTC) <= datetime.now(UTC):
            state = "expired"
        elif case.status == "rejected":
            state = "rejected"
        elif operation == "resume":
            if case.status != "executed":
                raise domain.CaseTargetNotReadyError("工单尚未完成，等待管理员确认")
            state = "completed"
    result = wait.result
    if state != wait.state:
        result = {"case_status": case.status, "resolution": case.resolution,
                  "executed": case.status == "executed"}
        repository.finish_approval_wait(db, request_id, state, result)
        db.commit()
    return {"request_id": request_id, "case_id": wait.case_id, "state": state,
            "case_status": case.status, "expires_at": wait.expires_at,
            "executed": case.status == "executed", "result": result,
            "agent_run_id": case.agent_run_id, "trace_id": wait.trace_id}
