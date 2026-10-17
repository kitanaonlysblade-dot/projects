"""push subscriptions

Revision ID: 0023_push_subscriptions
Revises: 0022_admin_mfa_lockout
Create Date: 2026-10-12
"""
from alembic import op
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa

revision = "0023_push_subscriptions"
down_revision = "0022_admin_mfa_lockout"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    if sa.inspect(op.get_bind()).has_table("push_subscriptions"):
        return
    uid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "push_subscriptions",
        sa.Column("id", uid, primary_key=True),
        sa.Column("user_id", uid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("endpoint", sa.String(1000), nullable=False, unique=True),
        sa.Column("p256dh", sa.String(200), nullable=False),
        sa.Column("auth", sa.String(100), nullable=False),
        sa.Column("user_agent", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS push_subscriptions")
