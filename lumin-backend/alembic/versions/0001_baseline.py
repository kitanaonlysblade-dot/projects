"""baseline: create every table that does not exist yet

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-04

This project was started without committed migrations, so existing
databases already have most tables. `create_all(checkfirst=True)` makes
this safe both ways: a fresh database gets the whole schema, an existing
one is left untouched (tables that exist are skipped; columns added later
are handled by the numbered migrations after this one).

It deliberately reads the *current* models, so it is only a correct
baseline while it is the first migration. From 0002 onward every schema
change is an explicit migration; never edit this file afterwards.
"""
from alembic import op

from app.models import Base

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    raise NotImplementedError("The baseline is not reversible; restore from a backup instead.")
