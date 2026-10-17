"""password reset signs out older sessions

Revision ID: 0020_sessions_valid_after
Revises: 0019_user_blocks
Create Date: 2026-10-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0020_sessions_valid_after"
down_revision = "0019_user_blocks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built it from the models.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "sessions_valid_after" not in cols:
        op.add_column("users", sa.Column("sessions_valid_after", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS sessions_valid_after")
