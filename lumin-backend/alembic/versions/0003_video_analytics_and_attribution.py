"""video views/analytics counters, lite video url, sales attribution

Revision ID: 0003_video_analytics_and_attribution
Revises: 0002a_widen_version_col
Create Date: 2026-10-04

Replaces the video half of the old app/ensure_schema.py.
"""
from alembic import op
from sqlalchemy import inspect

revision = "0003_video_analytics_and_attribution"
down_revision = "0002a_widen_version_col"
branch_labels = None
depends_on = None

VIDEO_COLUMNS = (
    "lite_video_url VARCHAR(500)",
    "views_count INTEGER NOT NULL DEFAULT 0",
    "unique_viewers_count INTEGER NOT NULL DEFAULT 0",
    "watch_seconds_total DOUBLE PRECISION NOT NULL DEFAULT 0",
    "completions_count INTEGER NOT NULL DEFAULT 0",
    "product_taps_count INTEGER NOT NULL DEFAULT 0",
    "cart_adds_count INTEGER NOT NULL DEFAULT 0",
)


def upgrade() -> None:
    from app.models import VideoView

    bind = op.get_bind()
    insp = inspect(bind)
    if insp.has_table("video_posts"):
        for column in VIDEO_COLUMNS:
            op.execute(f"ALTER TABLE video_posts ADD COLUMN IF NOT EXISTS {column}")
        for table in ("cart_items", "orders", "payments"):
            if insp.has_table(table):
                op.execute(
                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS source_video_post_id UUID "
                    "REFERENCES video_posts(id) ON DELETE SET NULL"
                )
    VideoView.__table__.create(bind=bind, checkfirst=True)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS video_views")
    for table in ("cart_items", "orders", "payments"):
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS source_video_post_id")
    for column in VIDEO_COLUMNS:
        op.execute(f"ALTER TABLE video_posts DROP COLUMN IF EXISTS {column.split()[0]}")
