"""native app push devices

Revision ID: 0027_push_devices
Revises: 0026_seller_verification
Create Date: 2026-10-13
"""
from alembic import op
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa

revision = "0027_push_devices"
down_revision = "0026_seller_verification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    if sa.inspect(op.get_bind()).has_table("push_devices"):
        return
    uid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "push_devices",
        sa.Column("id", uid, primary_key=True),
        sa.Column("user_id", uid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.String(500), nullable=False, unique=True),
        sa.Column("platform", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_push_devices_user_id", "push_devices", ["user_id"])


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS push_devices")
