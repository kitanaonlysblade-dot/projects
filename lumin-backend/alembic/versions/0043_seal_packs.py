"""products.seal_pack_size and seal_bags.pack_order_id: tamper-proof bags sold as ordinary shop products

Revision ID: 0043_seal_packs
Revises: 0042_shipments_claim_reasons
Create Date: 2026-10-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0043_seal_packs"
down_revision = "0042_shipments_claim_reasons"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    insp = sa.inspect(op.get_bind())
    if not any(c["name"] == "seal_pack_size" for c in insp.get_columns("products")):
        op.add_column("products", sa.Column("seal_pack_size", sa.Integer, nullable=True))
    if not any(c["name"] == "pack_order_id" for c in insp.get_columns("seal_bags")):
        op.add_column(
            "seal_bags",
            sa.Column("pack_order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("orders.id", ondelete="SET NULL"), nullable=True),
        )
        op.create_index("ix_seal_bags_pack_order_id", "seal_bags", ["pack_order_id"])


def downgrade() -> None:
    op.drop_index("ix_seal_bags_pack_order_id", table_name="seal_bags")
    op.drop_column("seal_bags", "pack_order_id")
    op.drop_column("products", "seal_pack_size")
