"""merchant_accounts: Stripe Connect account id and ready flag

Revision ID: 0046_stripe_connect
Revises: 0045_claim_auto_appeal
Create Date: 2026-10-21
"""
from alembic import op
import sqlalchemy as sa

revision = "0046_stripe_connect"
down_revision = "0045_claim_auto_appeal"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("merchant_accounts")}
    if "stripe_account_id" not in have:
        op.add_column("merchant_accounts", sa.Column("stripe_account_id", sa.String(64), nullable=True))
        op.create_unique_constraint("uq_merchant_accounts_stripe_account_id", "merchant_accounts", ["stripe_account_id"])
    if "stripe_ready" not in have:
        op.add_column("merchant_accounts", sa.Column("stripe_ready", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("merchant_accounts", "stripe_ready")
    op.drop_constraint("uq_merchant_accounts_stripe_account_id", "merchant_accounts", type_="unique")
    op.drop_column("merchant_accounts", "stripe_account_id")
