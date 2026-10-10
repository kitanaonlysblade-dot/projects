"""circle it: which frame of the clip the circle was drawn on

Revision ID: 0015_box_frame
Revises: 0014_search_box
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0015_box_frame"
down_revision = "0014_search_box"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("twin_searches")}
    if "box_at_ms" not in have:
        op.add_column("twin_searches", sa.Column("box_at_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("twin_searches", "box_at_ms")
