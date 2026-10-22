"""retwin_twins: which of the original's twins each retwin shows

Revision ID: 0006_retwin_twins_link
Revises: 0005_retwin_and_twin_requests
Create Date: 2026-10-06
"""
from alembic import op

revision = "0006_retwin_twins_link"
down_revision = "0005_retwin_and_twin_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.models import retwin_twins

    bind = op.get_bind()
    retwin_twins.create(bind=bind, checkfirst=True)
    # Existing retwins keep what they showed before: the original's twins that
    # already existed when the retwin was made.
    op.execute(
        "INSERT INTO retwin_twins (retwin_id, twin_id) "
        "SELECT r.id, t.id FROM video_posts r "
        "JOIN video_post_twins t ON t.video_post_id = r.retwin_of_id "
        "WHERE r.retwin_of_id IS NOT NULL AND t.created_at <= r.created_at "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS retwin_twins")
