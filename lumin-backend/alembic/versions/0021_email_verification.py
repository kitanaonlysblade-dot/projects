"""email verification codes

Revision ID: 0021_email_verification
Revises: 0020_sessions_valid_after
Create Date: 2026-10-12
"""
from alembic import op
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa

revision = "0021_email_verification"
down_revision = "0020_sessions_valid_after"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    insp = sa.inspect(op.get_bind())
    if "email_verified_at" not in {c["name"] for c in insp.get_columns("users")}:
        op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
        # Everyone who already has an account keeps using it: they count as verified.
        op.execute("UPDATE users SET email_verified_at = now()")
    if not insp.has_table("email_verification_codes"):
        uid = postgresql.UUID(as_uuid=True)
        op.create_table(
            "email_verification_codes",
            sa.Column("id", uid, primary_key=True),
            sa.Column("user_id", uid, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
            sa.Column("code_hash", sa.String(64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS email_verification_codes")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at")
