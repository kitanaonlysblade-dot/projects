"""notifications: twin_flagged (tap opens the video's twin editor)

Revision ID: 0034_twin_flagged_notification
Revises: 0033_report_reason_copied
Create Date: 2026-10-18
"""
from alembic import op

revision = "0034_twin_flagged_notification"
down_revision = "0033_report_reason_copied"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'twin_flagged'")


def downgrade() -> None:
    pass  # a Postgres enum value can't be dropped; an unused one is harmless
