"""系统巡检根任务仅绑定范围，不授予模型或服务凭证处置权限。"""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.governance import domain, repository, service_approvals
from app.modules.governance.schemas_workflow import PatrolWorkflowCreate, PatrolWorkflowOut
from app.modules.governance.service_workflow_scope import active_task


def create_task(db: Session, request: PatrolWorkflowCreate, trace_id: str) -> PatrolWorkflowOut:
    try:
        state = service_approvals.get_target_state(
            db,
            request.target_type,
            request.target_id,
            include_version=True,
            for_update=True,
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
            db,
            "patrol_workflow",
            trace_id,
            run_id,
            f"系统巡检根任务 {request.target_type}#{request.target_id}",
        )
        result = repository.create_patrol_workflow_task(
            db,
            key,
            PatrolWorkflowOut(
                task_id=task_id,
                source_kind="system_patrol",
                target_type=request.target_type,
                target_id=request.target_id,
                initial_version=state.state_version,
                trace_id=trace_id,
                agent_run_id=run_id,
                created_at=datetime.now(UTC).replace(tzinfo=None),
            ),
        )
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


def bind_task(db: Session, task_id: str, run_id: str):
    root = active_task(db, task_id)
    if root.workflow_run_id and root.workflow_run_id != run_id:
        raise domain.CaseTargetNotReadyError("根任务已绑定其他Workflow运行")
    result = repository.update_patrol_task(db, task_id, workflow_run_id=run_id)
    db.commit()
    return result


def finish_task(db: Session, task_id: str, status: str, reason: str):
    root = repository.get_patrol_workflow_task(db, task_id=task_id, for_update=True)
    if root is None:
        raise domain.DecisionNotFoundError()
    if root.status != "active":
        if root.status != status or root.stop_reason != reason:
            raise domain.CaseTargetNotReadyError("根任务已终止")
        return root
    result = repository.update_patrol_task(db, task_id, status=status, stop_reason=reason)
    repository.update_run(
        db,
        root.agent_run_id,
        "succeeded" if status == "completed" else "failed",
        reason if status == "completed" else None,
        reason if status != "completed" else None,
    )
    db.commit()
    return result


def unbound_tasks(db: Session):
    return repository.list_unbound_patrol_tasks(db)


def observe_task(db: Session, task_id: str):
    from app.modules.qa import service as qa_service

    root = active_task(db, task_id)
    snapshot = qa_service.moderation_get_snapshot(db, root.target_type, root.target_id)
    state = service_approvals.get_target_state(
        db, root.target_type, root.target_id, include_version=True
    )
    author_id = qa_service.get_content_author(db, root.target_type, root.target_id)
    author = (
        service_approvals.get_target_state(db, "user", author_id, include_version=True)
        if author_id
        else None
    )
    title = domain.redact_workflow_text(str(snapshot.get("title") or ""))
    body = domain.redact_workflow_text(str(snapshot.get("body") or ""))
    complete = len(title) + len(body) <= 20000
    return {
        "task_id": task_id,
        "observation_ref": f"obs-{uuid4()}",
        "content": state.model_dump(),
        "author": author.model_dump() if author else None,
        "excerpt": domain.audit_summary(body) or "",
        "title": title[:200],
        "body": body if complete else "",
        "content_complete": complete,
    }
