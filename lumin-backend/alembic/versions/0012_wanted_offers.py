"""wanted offers: a seller's "Twin it" on a wanted moment

Revision ID: 0012_wanted_offers
Revises: 0011_moment_evidence
Create Date: 2026-10-09
"""
from alembic import op
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa

revision = "0012_wanted_offers"
down_revision = "0011_moment_evidence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # checkfirst: on a fresh database the baseline already built this from the models.
    bind = op.get_bind()
    if sa.inspect(bind).has_table("wanted_offers"):
        return
    op.create_table(
        "wanted_offers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("query_key", sa.String(120), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seller_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("link_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("video_moment_products.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("query_key", "product_id", name="uq_wanted_offer_key_product"),
    )
    op.create_index("ix_wanted_offers_query_key", "wanted_offers", ["query_key"])
    op.create_index("ix_wanted_offers_product_id", "wanted_offers", ["product_id"])
    op.create_index("ix_wanted_offers_seller_user_id", "wanted_offers", ["seller_user_id"])
    op.create_index("ix_wanted_offers_link_id", "wanted_offers", ["link_id"])


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS wanted_offers")
