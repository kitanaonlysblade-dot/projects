"""Sign in with Apple: users.apple_sub

Revision ID: 0028_apple_sub
Revises: 0027_push_devices
Create Date: 2026-10-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0028_apple_sub"
down_revision = "0027_push_devices"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "apple_sub" in cols:
        return
    op.add_column("users", sa.Column("apple_sub", sa.String(255), nullable=True))
    op.create_index("ix_users_apple_sub", "users", ["apple_sub"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_apple_sub", table_name="users")
    op.drop_column("users", "apple_sub")
