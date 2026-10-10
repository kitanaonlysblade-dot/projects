"""retwins (a post that plays alongside an original) and twin requests

Revision ID: 0005_retwin_and_twin_requests
Revises: 0004_video_post_twins
Create Date: 2026-10-05
"""
from alembic import op

revision = "0005_retwin_and_twin_requests"
down_revision = "0004_video_post_twins"
branch_labels = None
depends_on = None

NEW_NOTIFICATION_TYPES = ("retwin", "twin_request", "twin_reply")


def upgrade() -> None:
    from app.models import TwinRequest, twin_request_supporters

    bind = op.get_bind()
    op.execute(
        "ALTER TABLE video_posts ADD COLUMN IF NOT EXISTS retwin_of_id UUID "
        "REFERENCES video_posts(id) ON DELETE CASCADE"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_video_posts_retwin_of_id ON video_posts (retwin_of_id)")
    TwinRequest.__table__.create(bind=bind, checkfirst=True)
    twin_request_supporters.create(bind=bind, checkfirst=True)
    with op.get_context().autocommit_block():
        for value in NEW_NOTIFICATION_TYPES:
            op.execute(f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS twin_request_supporters")
    op.execute("DROP TABLE IF EXISTS twin_requests")
    op.execute("DROP TYPE IF EXISTS twin_request_status")
    op.execute("DROP INDEX IF EXISTS ix_video_posts_retwin_of_id")
    op.execute("ALTER TABLE video_posts DROP COLUMN IF EXISTS retwin_of_id")
