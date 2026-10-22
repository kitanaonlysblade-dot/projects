"""video post twins: pair each tagged product with when it appears

Revision ID: 0004_video_post_twins
Revises: 0003_video_analytics_and_attribution
Create Date: 2026-10-05
"""
from alembic import op

revision = "0004_video_post_twins"
down_revision = "0003_video_analytics_and_attribution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.models import VideoPostTwin

    # checkfirst also creates the twin_review_status enum if needed.
    VideoPostTwin.__table__.create(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS video_post_twins")
    op.execute("DROP TYPE IF EXISTS twin_review_status")
