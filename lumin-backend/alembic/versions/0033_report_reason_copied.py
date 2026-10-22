"""reports: a "copied" reason

Revision ID: 0033_report_reason_copied
Revises: 0032_fingerprint_dup_of
Create Date: 2026-10-18
"""
from alembic import op

revision = "0033_report_reason_copied"
down_revision = "0032_fingerprint_dup_of"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    # ADD VALUE can't run inside the migration's transaction. IF NOT EXISTS: a fresh database already has it.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE report_reason ADD VALUE IF NOT EXISTS 'copied'")


def downgrade() -> None:
    pass  # a Postgres enum value can't be dropped; an unused one is harmless
