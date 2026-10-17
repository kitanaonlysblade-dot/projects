"""moment index: per-shopper evidence and a poster review on links

Revision ID: 0011_moment_evidence
Revises: 0010_twin_search_notify
Create Date: 2026-10-07
"""
from alembic import op
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa

revision = "0011_moment_evidence"
down_revision = "0010_twin_search_notify"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS / checkfirst: on a fresh database the baseline already built these
    # from the current models.
    op.execute("ALTER TABLE video_moment_products ADD COLUMN IF NOT EXISTS review VARCHAR(10)")
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("moment_evidence"):
        op.create_table(
            "moment_evidence",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("link_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("video_moment_products.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("video_post_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("video_posts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
            sa.Column("start_ms", sa.Integer(), nullable=False),
            sa.Column("end_ms", sa.Integer(), nullable=False),
            sa.Column("text_score", sa.Float(), nullable=False),
            sa.Column("kind", sa.String(4), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.UniqueConstraint("link_id", "user_id", name="uq_moment_evidence_link_user"),
        )
        op.create_index("ix_moment_evidence_link_id", "moment_evidence", ["link_id"])
        op.create_index("ix_moment_evidence_user_id", "moment_evidence", ["user_id"])
        op.create_index("ix_moment_evidence_video_post_id", "moment_evidence", ["video_post_id"])
    # Links built under the old "any cart-add counts" rule have no per-shopper evidence,
    # so they can't be verified: drop them rather than keep trusting noise.
    op.execute(
        "DELETE FROM video_moment_products WHERE review IS NULL AND NOT EXISTS "
        "(SELECT 1 FROM moment_evidence e WHERE e.link_id = video_moment_products.id)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS moment_evidence")
    op.execute("ALTER TABLE video_moment_products DROP COLUMN IF EXISTS review")
