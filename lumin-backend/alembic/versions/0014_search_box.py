"""circle it: the part of the frame a search is about

Revision ID: 0014_search_box
Revises: 0013_request_key
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_search_box"
down_revision = "0013_request_key"
branch_labels = None
depends_on = None

_COLS = ("box_x", "box_y", "box_w", "box_h")


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("twin_searches")}
    for name in _COLS:
        if name not in have:
            op.add_column("twin_searches", sa.Column(name, sa.Float(), nullable=True))


def downgrade() -> None:
    for name in reversed(_COLS):
        op.drop_column("twin_searches", name)
