"""shipments (the sealed order's journey + delivery code) and return_claims.reasons

Revision ID: 0042_shipments_claim_reasons
Revises: 0041_seal_bags
Create Date: 2026-10-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0042_shipments_claim_reasons"
down_revision = "0041_seal_bags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    insp = sa.inspect(op.get_bind())
    if not any(c["name"] == "reasons" for c in insp.get_columns("return_claims")):
        op.add_column("return_claims", sa.Column("reasons", postgresql.ARRAY(sa.String), nullable=False, server_default="{}"))
    if insp.has_table("shipments"):
        return
    U = postgresql.UUID(as_uuid=True)
    op.create_table(
        "shipments",
        sa.Column("id", U, primary_key=True),
        sa.Column("order_id", U, sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("bag_id", U, sa.ForeignKey("seal_bags.id", ondelete="CASCADE"), nullable=False),
        sa.Column("courier", sa.String(30), nullable=False, server_default="manual"),
        sa.Column("courier_ref", sa.String(100), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="awaiting_pickup"),
        sa.Column("driver_name", sa.String(100), nullable=True),
        sa.Column("picked_up_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("arrived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seal_intact", sa.Boolean, nullable=True),
        sa.Column("refusal_note", sa.String(500), nullable=True),
        sa.Column("otp_hash", sa.String(64), nullable=True),
        sa.Column("otp_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("otp_attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("otp_issued", sa.Integer, nullable=False, server_default="0"),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_shipments_bag_id", "shipments", ["bag_id"])
    op.create_index("ix_shipments_status", "shipments", ["status"])


def downgrade() -> None:
    op.drop_table("shipments")
    op.drop_column("return_claims", "reasons")
