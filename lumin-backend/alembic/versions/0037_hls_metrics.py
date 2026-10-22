"""hls_metrics: playback measurements (time-to-first-frame, stalls, quality reached, mp4 fallback)

Revision ID: 0037_hls_metrics
Revises: 0036_video_hls_url
Create Date: 2026-10-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0037_hls_metrics"
down_revision = "0036_video_hls_url"
branch_labels = None
depends_on = None

# create_type=False: the type is created explicitly (checkfirst) in upgrade().
# Without it, op.create_table fires its own CREATE TYPE for this column and
# fails with 'type "hls_metric_kind" already exists'.
_KIND = postgresql.ENUM(
    "ttff", "stall", "level_reached", "fallback", name="hls_metric_kind", create_type=False
)


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    bind = op.get_bind()
    if sa.inspect(bind).has_table("hls_metrics"):
        return
    uid = postgresql.UUID(as_uuid=True)
    _KIND.create(bind, checkfirst=True)
    op.create_table(
        "hls_metrics",
        sa.Column("id", uid, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("user_id", uid, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("video_post_id", uid, sa.ForeignKey("video_posts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", _KIND, nullable=False),
        sa.Column("is_hls", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("lite", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("value_ms", sa.Integer(), nullable=True),
        sa.Column("level", sa.Integer(), nullable=True),
        sa.Column("connection", sa.String(20), nullable=True),
    )
    op.create_index("ix_hls_metrics_kind_created_at", "hls_metrics", ["kind", "created_at"])


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS hls_metrics")
    _KIND.drop(op.get_bind(), checkfirst=True)
