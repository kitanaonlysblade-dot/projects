"""Guards against drift: running every migration on an empty database must
produce exactly the schema the models describe. If this fails, a model
changed without a matching migration (create one with
`alembic revision --autogenerate -m "..."`, then review it)."""
import os
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext

from app.database import engine
from app.models import Base

ROOT = Path(__file__).resolve().parent.parent


def test_migrations_match_models():
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    Base.metadata.drop_all(engine)
    with engine.begin() as conn:
        conn.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
    cwd = os.getcwd()
    os.chdir(ROOT)  # env.py puts the cwd on sys.path to import `app`
    try:
        command.upgrade(cfg, "head")
        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
        assert diff == [], f"models and migrations disagree: {diff}"
        command.upgrade(cfg, "head")  # re-running must be a harmless no-op
    finally:
        os.chdir(cwd)
        Base.metadata.drop_all(engine)
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP TABLE IF EXISTS alembic_version")
        Base.metadata.create_all(engine)
