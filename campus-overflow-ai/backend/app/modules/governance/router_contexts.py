import hashlib
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.permissions import UserPrincipal, require_roles
from app.core.response import ok
from app.db.session import get_db
from app.modules.governance import service_contexts
from app.modules.governance.router_internal import get_agent_admin
from app.modules.governance.schemas_contexts import MemoryDocument, SessionCreate, SessionWrite

Db = Annotated[Session, Depends(get_db)]


def build_router(prefix: str, auth, *, internal: bool) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=["私人上下文"])

    def scope(request: Request, admin: Annotated[UserPrincipal, Depends(auth)], db: Db):
        key = request.headers.get("x-external-agent-key") if internal else None
        return service_contexts.namespace(
            db, admin.id, hashlib.sha256(key.encode()).hexdigest() if key else None
        )

    Scope = Annotated[tuple[str, ...], Depends(scope)]

    @router.get("/memory")
    def read_memory(owner: Scope):
        return ok(service_contexts.memory(owner))

    @router.put("/memory")
    def write_memory(req: MemoryDocument, owner: Scope):
        return ok(service_contexts.memory(owner, req))

    @router.get("/sessions")
    def list_sessions(owner: Scope):
        return ok(service_contexts.list_sessions(owner))

    @router.post("/sessions")
    def create_session(req: SessionCreate, owner: Scope):
        return ok(service_contexts.create_session(owner, req))

    @router.get("/sessions/{session_id}")
    def read_session(session_id: UUID, owner: Scope):
        return ok(service_contexts.session(owner, str(session_id)))

    @router.put("/sessions/{session_id}")
    def write_session(session_id: UUID, req: SessionWrite, owner: Scope):
        return ok(service_contexts.session(owner, str(session_id), req))

    @router.delete("/sessions/{session_id}")
    def delete_session(
        session_id: UUID, owner: Scope, version: Annotated[int, Header(alias="If-Match", ge=1)]
    ):
        return ok(service_contexts.session(owner, str(session_id), delete_version=version))

    return router


router = build_router("/api/governance/private-context", require_roles("admin"), internal=False)
internal_router = build_router(
    "/internal/agent/user/private-context", get_agent_admin, internal=True
)
