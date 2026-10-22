"""seller verification

Revision ID: 0026_seller_verification
Revises: 0025_jobs
Create Date: 2026-10-13
"""
from alembic import op
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa

revision = "0026_seller_verification"
down_revision = "0025_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    insp = sa.inspect(op.get_bind())
    if "verified_at" not in {c["name"] for c in insp.get_columns("merchant_accounts")}:
        op.add_column("merchant_accounts", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
    if not insp.has_table("seller_verifications"):
        uid = postgresql.UUID(as_uuid=True)
        op.create_table(
            "seller_verifications",
            sa.Column("id", uid, primary_key=True),
            sa.Column("merchant_id", uid, sa.ForeignKey("merchant_accounts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
            sa.Column("legal_name", sa.String(150), nullable=False),
            sa.Column("doc_type", sa.String(25), nullable=False),
            sa.Column("document_key", sa.String(300), nullable=True),
            sa.Column("selfie_key", sa.String(300), nullable=True),
            sa.Column("note", sa.String(300), nullable=True),
            sa.Column("reviewed_by", uid, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("ix_seller_verifications_merchant_id", "seller_verifications", ["merchant_id"])
        op.create_index("ix_seller_verifications_status", "seller_verifications", ["status"])


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS seller_verifications")
    op.execute("ALTER TABLE merchant_accounts DROP COLUMN IF EXISTS verified_at")
