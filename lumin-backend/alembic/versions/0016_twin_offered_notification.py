"""notification type: a seller offered a twin for a moment of your video

Revision ID: 0016_twin_offered_notification
Revises: 0015_box_frame
Create Date: 2026-10-10
"""
from alembic import op

revision = "0016_twin_offered_notification"
down_revision = "0015_box_frame"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'twin_offered'")


def downgrade() -> None:
    # Postgres can't drop one enum value; it stays, unused.
    pass
