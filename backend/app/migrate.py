"""Brings the database up to the version this code expects (Alembic)."""

import logging
import os
import sqlite3
from contextlib import closing
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect

BASELINE = "0001"  # the tables as they were before ArGuide used migrations
MIGRATIONS = Path(__file__).resolve().parent / "migrations"
log = logging.getLogger(__name__)


def _config(connection=None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS).replace("%", "%%"))
    config.attributes["connection"] = connection
    return config


def _run(engine, action, revision: str) -> None:
    with engine.begin() as connection:
        action(_config(connection), revision)


def _tables(engine) -> dict[str, set[str]]:
    found = inspect(engine)
    return {table: {c["name"] for c in found.get_columns(table)} for table in found.get_table_names()}


def _made_before_migrations(engine) -> bool:
    """True for ArGuide tables that carry no version. Refuses them if they differ from the baseline."""
    existing = _tables(engine)
    reference = create_engine("sqlite://")
    _run(reference, command.upgrade, BASELINE)
    expected = _tables(reference)
    del expected["alembic_version"]
    if not expected.keys() & existing.keys():
        return False
    if any(existing.get(table) != columns for table, columns in expected.items()):
        raise RuntimeError(
            "This database was made by an older ArGuide and cannot be upgraded. "
            "Keep it, and start the API with a new DATA_DIR (see README.md)."
        )
    return True


def backup_sqlite(engine, revision: str) -> Path | None:
    """Copies a SQLite file before it is changed. Other databases need their own backups."""
    name = engine.url.database
    if engine.dialect.name != "sqlite" or not name or name == ":memory:":
        return None
    source = Path(name)
    copy = source.with_name(f"{source.name}.pre-{revision}")
    if not copy.exists():  # after a failed upgrade, the first copy is the good one
        part = copy.with_name(f"{copy.name}.part")
        part.unlink(missing_ok=True)
        with closing(sqlite3.connect(source)) as old, closing(sqlite3.connect(part)) as new:
            old.backup(new)
        os.replace(part, copy)
    return copy


def upgrade_db(engine) -> None:
    # ponytail: runs inside each API process at start-up. With more than one process,
    # run it as a separate step before they start.
    scripts = ScriptDirectory.from_config(_config())
    head = scripts.get_current_head()
    with engine.connect() as connection:
        current = MigrationContext.configure(connection).get_current_revision()
    if current is None and _made_before_migrations(engine):
        _run(engine, command.stamp, BASELINE)
        current = BASELINE
    if current == head:
        return
    if current is not None:
        if current not in {script.revision for script in scripts.walk_revisions()}:
            log.warning("The database is newer than this code (version %s). Leaving it as it is.", current)
            return
        backup_sqlite(engine, head)
    _run(engine, command.upgrade, "head")
