"""sponsored twins: style/colour/audience tags and per-pair learning counters

Revision ID: 0038_sponsored_style_pairs
Revises: 0037_hls_metrics
Create Date: 2026-10-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0038_sponsored_style_pairs"
down_revision = "0037_hls_metrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("sponsored_twins")}
    for name in ("style", "color", "audience"):
        if name not in cols:
            op.add_column("sponsored_twins", sa.Column(name, sa.String(20), nullable=True))
    if "sponsored_pairs" not in insp.get_table_names():
        op.create_table(
            "sponsored_pairs",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("sponsored_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sponsored_twins.id", ondelete="CASCADE"), nullable=False),
            sa.Column("anchor_product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
            sa.Column("shown", sa.Integer, nullable=False, server_default="0"),
            sa.Column("clicks", sa.Integer, nullable=False, server_default="0"),
            sa.Column("carts", sa.Integer, nullable=False, server_default="0"),
            sa.Column("buys", sa.Integer, nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("sponsored_id", "anchor_product_id", name="uq_sponsored_pair"),
        )
        op.create_index("ix_sponsored_pairs_sponsored_id", "sponsored_pairs", ["sponsored_id"])
        op.create_index("ix_sponsored_pairs_anchor_product_id", "sponsored_pairs", ["anchor_product_id"])


def downgrade() -> None:
    op.drop_table("sponsored_pairs")
    for name in ("audience", "color", "style"):
        op.drop_column("sponsored_twins", name)
