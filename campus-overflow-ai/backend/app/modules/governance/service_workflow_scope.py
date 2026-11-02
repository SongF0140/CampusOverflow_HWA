"""系统根任务范围校验；系统身份不映射到任何管理员账号。"""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.governance import domain, repository
from app.modules.qa import service as qa_service


def active_task(db: Session, task_id: str):
    if not settings.governance_workflow_enabled:
        raise domain.GovernanceExecutorDisabledError()
    root = repository.get_patrol_workflow_task(db, task_id=task_id, for_update=True)
    if root is None:
        raise domain.DecisionNotFoundError()
    if root.status != "active" or root.created_at.replace(tzinfo=UTC) + timedelta(
        days=7
    ) <= datetime.now(UTC):
        raise domain.CaseTargetNotReadyError("根任务已结束或过期")
    return root


def action_target(db: Session, root, action: str) -> tuple[str, int]:
    if action in {"hide", "delete"}:
        return root.target_type, root.target_id
    snapshot = qa_service.moderation_get_snapshot(
        db, root.target_type, root.target_id, for_update=True,
    )
    author_id = snapshot.get("author_id")
    if author_id is None:
        raise domain.CaseTargetNotReadyError("关联作者不存在")
    return "user", author_id


def verify_system_call(db: Session, item) -> None:
    call = item.frozen_call
    if (
        call.requester_id is not None
        or item.requester_id is not None
        or not call.workflow_task_id
        or call.workflow_round is None
    ):
        raise domain.CaseActionForbiddenError("系统申请身份绑定无效")
    root = active_task(db, call.workflow_task_id)
    if action_target(db, root, call.action) != (call.target_type, call.target_id):
        raise domain.CaseActionForbiddenError("系统申请超出根任务目标范围")
