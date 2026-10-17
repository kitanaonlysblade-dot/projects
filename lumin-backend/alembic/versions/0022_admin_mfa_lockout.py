"""admin two-step login + login lockout

Revision ID: 0022_admin_mfa_lockout
Revises: 0021_email_verification
Create Date: 2026-10-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0022_admin_mfa_lockout"
down_revision = "0021_email_verification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("users")}
    if "totp_secret" not in have:
        op.add_column("users", sa.Column("totp_secret", sa.String(200), nullable=True))
    if "totp_enabled" not in have:
        op.add_column("users", sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "totp_last_step" not in have:
        op.add_column("users", sa.Column("totp_last_step", sa.BigInteger(), nullable=True))
    if "failed_logins" not in have:
        op.add_column("users", sa.Column("failed_logins", sa.Integer(), nullable=False, server_default="0"))
    if "locked_until" not in have:
        op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for col in ("locked_until", "failed_logins", "totp_last_step", "totp_enabled", "totp_secret"):
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {col}")
