"""业务发现持久分页：固定页快照，处理完成后CAS确认，失败不前移。"""

from copy import deepcopy

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.governance import domain, repository
from app.modules.qa import service as qa_service


def read_page(db: Session):
    try:
        checkpoint = repository.get_patrol_scan(db)
    except IntegrityError:
        db.rollback()
        checkpoint = repository.get_patrol_scan(db)
    state = deepcopy(checkpoint["state"])
    pending = state.get("pending")
    if pending is None:
        rows = qa_service.list_workflow_patrol_page(db, state.get("cursor"))
        items = [{"target_type": row.target_type, "target_id": row.target_id} for row in rows]
        pending = {
            "items": items,
            "has_more": len(items) == 100,
            "next_cursor": items[-1] if len(items) == 100 else None,
        }
        state["pending"] = pending
        repository.save_patrol_scan(db, state, checkpoint["revision"])
    db.commit()
    return {
        "revision": checkpoint["revision"],
        "items": pending["items"],
        "has_more": pending["has_more"],
    }


def acknowledge_page(db: Session, revision: int):
    checkpoint = repository.get_patrol_scan(db)
    state = checkpoint["state"]
    if checkpoint["revision"] != revision or state.get("pending") is None:
        raise domain.CaseTargetNotReadyError("巡检页已变化，请重新读取")
    repository.save_patrol_scan(db, {"cursor": state["pending"]["next_cursor"]}, revision + 1)
    db.commit()
    return {"revision": revision + 1}
