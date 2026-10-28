"""审批协调的只读基础；真实处置仍由现有治理用例完成。"""

from sqlalchemy.orm import Session

from app.modules.governance.schemas import GovernanceTargetStateOut
from app.modules.identity import domain as identity_domain
from app.modules.identity import service as identity_service
from app.modules.qa import service as qa_service


def get_target_state(
    db: Session, target_type: str, target_id: int,
) -> GovernanceTargetStateOut:
    """仅查目标自身状态，不调用会惰性解禁的用户治理探针。"""
    if target_type == "user":
        try:
            state = identity_service.get_by_id(db, target_id).status
        except identity_domain.UserNotFoundError:
            state = "missing"
    else:
        state = qa_service.probe_moderation_target(db, target_type, target_id)
    return GovernanceTargetStateOut(
        target_type=target_type, target_id=target_id, current_state=state,
    )
