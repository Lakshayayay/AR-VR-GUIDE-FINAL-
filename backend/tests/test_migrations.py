"""Database upgrades: new, made before migrations, too old, newer than the code, backups."""

import os
import sqlite3
import tempfile
from contextlib import closing

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arguide-test-"))

import pytest  # noqa: E402
from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.migration import MigrationContext  # noqa: E402
from sqlalchemy import create_engine, inspect, text  # noqa: E402

from app.db import Base  # noqa: E402
from app.migrate import BASELINE, backup_sqlite, upgrade_db  # noqa: E402

ADD_PERSON = text(
    "INSERT INTO users (username, name, role, active, created_at)"
    " VALUES ('ravi', 'Ravi', 'technician', 1, '2026-11-01 00:00:00')"
)


def sqlite_at(path):
    return create_engine(f"sqlite:///{path}")


def revision(engine):
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def test_a_new_database_gets_exactly_the_tables_the_app_expects(tmp_path):
    engine = sqlite_at(tmp_path / "new.db")
    upgrade_db(engine)
    assert revision(engine) == BASELINE
    with engine.connect() as connection:
        # Fails when a model changes without a migration.
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    assert not list(tmp_path.glob("*.pre-*")), "a new database needs no backup"


def test_a_database_from_before_migrations_keeps_its_records(tmp_path):
    engine = sqlite_at(tmp_path / "old.db")
    Base.metadata.create_all(engine)  # how ArGuide made its tables before migrations
    with engine.begin() as connection:
        connection.execute(ADD_PERSON)
    upgrade_db(engine)
    upgrade_db(engine)  # the next start changes nothing
    assert revision(engine) == BASELINE
    with engine.connect() as connection:
        assert connection.execute(text("SELECT username FROM users")).scalars().all() == ["ravi"]


def test_a_database_from_the_password_version_is_refused_and_left_alone(tmp_path):
    engine = sqlite_at(tmp_path / "passwords.db")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)"))
    with pytest.raises(RuntimeError, match="new DATA_DIR"):
        upgrade_db(engine)
    assert "alembic_version" not in inspect(engine).get_table_names()


def test_a_database_newer_than_the_code_is_left_alone(tmp_path):
    """Rolling the code back must not stop the app from starting."""
    engine = sqlite_at(tmp_path / "newer.db")
    upgrade_db(engine)
    with engine.begin() as connection:
        connection.execute(text("UPDATE alembic_version SET version_num = '9999'"))
    upgrade_db(engine)
    assert revision(engine) == "9999"


def test_a_backup_holds_the_records_and_a_retry_does_not_overwrite_it(tmp_path):
    engine = sqlite_at(tmp_path / "arguide.db")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE t (v TEXT)"))
        connection.execute(text("INSERT INTO t VALUES ('before')"))
    copy = backup_sqlite(engine, "0002")
    assert copy == tmp_path / "arguide.db.pre-0002"
    with engine.begin() as connection:
        connection.execute(text("UPDATE t SET v = 'after'"))
    assert backup_sqlite(engine, "0002") == copy
    with closing(sqlite3.connect(copy)) as saved:
        assert saved.execute("SELECT v FROM t").fetchall() == [("before",)]
    assert backup_sqlite(create_engine("sqlite://"), "0002") is None
