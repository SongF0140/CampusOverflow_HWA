"""受控私有文件仓储；命名空间锁跨进程，版本比较和原子替换共用锁。"""

import json
import os
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from app.core.domain_error import DomainError


class ContextUnavailable(DomainError):
    """私人存储未配置、损坏或不可用，请联系管理员。"""

    http_status = 503


class ContextConflict(DomainError):
    """私人数据已更新，请重新读取后再修改。"""

    http_status = 409


def safe_path(root: Path, *parts: str) -> Path:
    path = root
    for part in parts:
        path = path / part
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
            raise ContextUnavailable()
    if not path.resolve().is_relative_to(root):
        raise ContextUnavailable()
    return path


@contextmanager
def locked(root: str, namespace: tuple[str, ...]):
    if not root:
        raise ContextUnavailable()
    base = Path(root).resolve()
    if any(part.lower() in {"public", "static"} for part in base.parts):
        raise ContextUnavailable()
    try:
        folder = safe_path(base, *namespace)
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = safe_path(base, *namespace, ".lock")
        with path.open("a+b") as handle:
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl

                fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield folder
            finally:
                handle.seek(0)
                if os.name == "nt":
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle, fcntl.LOCK_UN)
    except OSError:
        raise ContextUnavailable() from None


def load(folder: Path, filename: str) -> dict | None:
    path = safe_path(folder.resolve(), filename)
    if not path.exists():
        return None
    try:
        if path.stat().st_size > 2_100_000:
            raise ContextUnavailable()
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ContextUnavailable()
        return value
    except (OSError, ValueError):
        raise ContextUnavailable() from None


def save(folder: Path, filename: str, document: dict) -> None:
    target = safe_path(folder.resolve(), filename)
    encoded = json.dumps(document, ensure_ascii=False).encode("utf-8")
    if len(encoded) > 2_100_000:
        raise DomainError("会话内容过大，请缩短后保存")
    temporary = folder / f".{uuid4().hex}.tmp"
    try:
        with temporary.open("xb") as handle:
            os.chmod(temporary, 0o600)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
