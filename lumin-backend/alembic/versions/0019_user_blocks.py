"""block users

Revision ID: 0019_user_blocks
Revises: 0018_scan
Create Date: 2026-10-12
"""
from alembic import op
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa

revision = "0019_user_blocks"
down_revision = "0018_scan"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    if sa.inspect(op.get_bind()).has_table("user_blocks"):
        return
    uid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "user_blocks",
        sa.Column("blocker_id", uid, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("blocked_id", uid, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_user_blocks_blocked_id", "user_blocks", ["blocked_id"])


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_blocks")
