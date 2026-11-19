"""来源、账号和客户端由后端认证派生，文件路径不接受客户端输入。"""

import re
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.domain_error import DomainError
from app.modules.governance import context_files as files
from app.modules.governance import domain, service_executions
from app.modules.governance.schemas_contexts import (
    MemoryDocument,
    SessionCreate,
    SessionDocument,
    SessionWrite,
)


def namespace(db: Session, user_id: int, key_hash: str | None) -> tuple[str, ...]:
    service_executions._admin(db, user_id)
    if key_hash is None:
        return ("admin", f"u_{user_id}")
    mappings = domain.parse_external_admin_mappings(settings.external_agent_keys)
    entry = next(
        (
            item
            for item in mappings or []
            if item["key_hash"] == key_hash and item["enabled"] and item["user_id"] == user_id
        ),
        None,
    )
    if entry is None:
        raise domain.CaseActionForbiddenError("来源凭证已撤销")
    if not entry.get("client_id"):
        raise files.ContextUnavailable("中台私人存储尚未配置稳定客户端编号")
    return ("platform", f"c_{entry['client_id']}", f"u_{user_id}")


def _validated(schema, value):
    try:
        return schema.model_validate(value).model_dump(mode="json")
    except ValueError:
        raise files.ContextUnavailable() from None


def memory(scope: tuple[str, ...], update: MemoryDocument | None = None) -> dict:
    if scope[0] != "admin":
        raise domain.CaseActionForbiddenError("中台不能读取管理员个人记忆")
    with files.locked(settings.private_context_root, scope) as folder:
        loaded = files.load(folder, "memory.json")
        current = _validated(
            MemoryDocument, loaded if loaded is not None else {"version": 0, "entries": []}
        )
        if update:
            if current["version"] != update.version:
                raise files.ContextConflict()
            current = {**update.model_dump(mode="json"), "version": current["version"] + 1}
            files.save(folder, "memory.json", current)
        return current


def _sessions(folder) -> list[dict]:
    directory = files.safe_path(folder.resolve(), "sessions")
    directory.mkdir(exist_ok=True, mode=0o700)
    result = []
    for path in directory.glob("*.json"):
        item = _validated(SessionDocument, files.load(directory, path.name))
        if not item["deleted"]:
            result.append(item)
    return result


def list_sessions(scope: tuple[str, ...]) -> list[dict]:
    with files.locked(settings.private_context_root, scope) as folder:
        return _sessions(folder)


def _safe_messages(messages) -> None:
    for item in messages:
        if re.search(
            r"(?i)(bearer\s+\S+|(?:password|api_key|token|密码|密钥)\s*[:=：]\s*\S+)", item.text
        ):
            raise DomainError("会话包含敏感凭证，拒绝持久保存")


def create_session(scope: tuple[str, ...], req: SessionCreate) -> dict:
    _safe_messages(req.messages)
    with files.locked(settings.private_context_root, scope) as folder:
        existing = _sessions(folder)
        if req.import_key:
            previous = next((s for s in existing if s["import_key"] == str(req.import_key)), None)
            if previous:
                return previous
        if len(existing) >= 20:
            raise DomainError("最多保存20个会话，请先删除部分会话")
        item = SessionDocument(**req.model_dump(), id=uuid4(), version=1).model_dump(mode="json")
        files.save(folder / "sessions", f"{item['id']}.json", item)
        return item


def session(
    scope: tuple[str, ...],
    session_id: str,
    update: SessionWrite | None = None,
    delete_version: int | None = None,
) -> dict:
    with files.locked(settings.private_context_root, scope) as folder:
        directory = files.safe_path(folder.resolve(), "sessions")
        current = files.load(directory, f"{session_id}.json")
        if current is None or current.get("deleted"):
            raise domain.DecisionNotFoundError("会话不存在")
        current = _validated(SessionDocument, current)
        if current["id"] != session_id:
            raise files.ContextUnavailable()
        expected = update.version if update else delete_version
        if expected is not None:
            if expected != current["version"]:
                raise files.ContextConflict()
            if update:
                _safe_messages(update.messages)
                current.update(update.model_dump(mode="json"))
            else:
                current.update(deleted=True, messages=[], title="已删除会话")
            current["version"] += 1
            files.save(directory, f"{session_id}.json", current)
        return current
