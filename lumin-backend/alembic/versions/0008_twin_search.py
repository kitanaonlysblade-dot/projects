"""twin search (replaces twin requests + retwins), video-moment index, merchant keyword insights

Revision ID: 0008_twin_search
Revises: 0007_retwin_kind_and_sync
Create Date: 2026-10-06

Nothing is dropped: the twin_requests / retwin tables and columns stay (unused) so no
data is lost and the feature can come back. Video retwins are detached so they carry
on as ordinary posts of their own, the same thing that already happens when an
original is deleted.
"""
from alembic import op

revision = "0008_twin_search"
down_revision = "0007_retwin_kind_and_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.models import TwinSearch, VideoMomentProduct

    bind = op.get_bind()
    TwinSearch.__table__.create(bind=bind, checkfirst=True)
    VideoMomentProduct.__table__.create(bind=bind, checkfirst=True)
    op.execute("ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS insights_until TIMESTAMP WITH TIME ZONE")
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'twin_available'")
    op.execute(
        "UPDATE video_posts SET retwin_of_id = NULL, retwin_kind = NULL, sync_offset_ms = 0 "
        "WHERE retwin_of_id IS NOT NULL AND retwin_kind = 'video'"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS video_moment_products")
    op.execute("DROP TABLE IF EXISTS twin_searches")
    op.execute("DROP TYPE IF EXISTS twin_search_status")
    op.execute("ALTER TABLE merchant_accounts DROP COLUMN IF EXISTS insights_until")
    # The enum value and the detached retwins are not restored.
