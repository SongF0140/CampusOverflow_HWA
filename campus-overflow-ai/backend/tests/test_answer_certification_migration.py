"""只在隔离 SQLite 验证认证位迁移，不运行真实业务库。"""

from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.core.config import settings


def test_certification_migration_preserves_legacy_flags(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'tw02.sqlite').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE answers (
                id INTEGER PRIMARY KEY, body TEXT NOT NULL,
                recommended_by_assistant BOOLEAN NOT NULL,
                certified_by_teacher BOOLEAN NOT NULL
            )
        """))
        connection.execute(text("INSERT INTO answers VALUES (1, '旧回答', 1, 1)"))
    config = Config("alembic.ini")
    command.stamp(config, "t15_ban_temp")
    command.upgrade(config, "tw02_assistant_cert")
    with engine.connect() as connection:
        assert connection.execute(text(
            "SELECT recommended_by_assistant, certified_by_teacher, certified_by_assistant "
            "FROM answers"
        )).one() == (1, 1, 0)
    command.downgrade(config, "t15_ban_temp")
    columns = {c["name"] for c in inspect(engine).get_columns("answers")}
    assert "certified_by_assistant" not in columns
    command.upgrade(config, "tw02_assistant_cert")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT certified_by_assistant FROM answers")).scalar() == 0
    engine.dispose()
