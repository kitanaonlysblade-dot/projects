"""twin_searches: remember which products a search showed (exact and closest)

Revision ID: 0009_twin_search_shown
Revises: 0008_twin_search
Create Date: 2026-10-07
"""
from alembic import op

revision = "0009_twin_search_shown"
down_revision = "0008_twin_search"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: on a fresh database 0008 already creates the table from the current
    # model, which has these columns.
    op.execute("ALTER TABLE twin_searches ADD COLUMN IF NOT EXISTS result_ids UUID[] NOT NULL DEFAULT '{}'")
    op.execute("ALTER TABLE twin_searches ADD COLUMN IF NOT EXISTS closest_ids UUID[] NOT NULL DEFAULT '{}'")


def downgrade() -> None:
    op.execute("ALTER TABLE twin_searches DROP COLUMN IF EXISTS closest_ids")
    op.execute("ALTER TABLE twin_searches DROP COLUMN IF EXISTS result_ids")
