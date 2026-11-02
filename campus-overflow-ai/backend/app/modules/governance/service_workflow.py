"""系统巡检根任务仅绑定范围，不授予模型或服务凭证处置权限。"""
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.governance import domain, repository, service_approvals
from app.modules.governance.schemas_workflow import PatrolWorkflowCreate, PatrolWorkflowOut


def create_task(db: Session, request: PatrolWorkflowCreate, trace_id: str) -> PatrolWorkflowOut:
    try:
        state = service_approvals.get_target_state(
            db, request.target_type, request.target_id, include_version=True, for_update=True,
        )
        if state.current_state != "ready":
            raise domain.CaseTargetNotReadyError("目标不存在或当前不可巡检")
        key = f"{request.target_type}:{request.target_id}:{state.state_version}"
        existing = repository.get_patrol_workflow_task(db, source_key=key)
        if existing:
            db.rollback()
            return existing.model_copy(update={"repeat": True})
        task_id = str(uuid4())
        run_id = f"patrol-workflow-{task_id}"
        repository.create_run(
            db, "patrol_workflow", trace_id, run_id,
            f"系统巡检根任务 {request.target_type}#{request.target_id}",
        )
        result = repository.create_patrol_workflow_task(db, key, PatrolWorkflowOut(
            task_id=task_id, source_kind="system_patrol", target_type=request.target_type,
            target_id=request.target_id, initial_version=state.state_version,
            trace_id=trace_id, agent_run_id=run_id,
            created_at=datetime.now(UTC).replace(tzinfo=None),
        ))
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        existing = repository.get_patrol_workflow_task(db, source_key=key)
        if existing:
            return existing.model_copy(update={"repeat": True})
        raise
    except Exception:
        db.rollback()
        raise


def read_task(db: Session, task_id: str) -> PatrolWorkflowOut | None:
    return repository.get_patrol_workflow_task(db, task_id=task_id)
