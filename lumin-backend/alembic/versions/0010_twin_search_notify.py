"""twin_searches.notify: the Wanted board's bell

Revision ID: 0010_twin_search_notify
Revises: 0009_twin_search_shown
Create Date: 2026-10-07
"""
from alembic import op

revision = "0010_twin_search_notify"
down_revision = "0009_twin_search_shown"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: a fresh database gets the column from 0008's create (current model).
    op.execute("ALTER TABLE twin_searches ADD COLUMN IF NOT EXISTS notify BOOLEAN NOT NULL DEFAULT true")


def downgrade() -> None:
    op.execute("ALTER TABLE twin_searches DROP COLUMN IF EXISTS notify")
