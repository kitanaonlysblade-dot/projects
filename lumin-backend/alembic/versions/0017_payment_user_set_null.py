"""payments.user_id: keep the payment when the account is deleted

Revision ID: 0017_payment_user_set_null
Revises: 0016_twin_offered_notification
Create Date: 2026-10-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0017_payment_user_set_null"
down_revision = "0016_twin_offered_notification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for fk in insp.get_foreign_keys("payments"):
        if fk["constrained_columns"] == ["user_id"] and fk["referred_table"] == "users":
            op.drop_constraint(fk["name"], "payments", type_="foreignkey")
    op.alter_column("payments", "user_id", existing_type=sa.UUID(), nullable=True)
    op.create_foreign_key("payments_user_id_fkey", "payments", "users", ["user_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    # Rows whose person was deleted can't satisfy NOT NULL again, so they are removed.
    op.execute("DELETE FROM payments WHERE user_id IS NULL")
    op.drop_constraint("payments_user_id_fkey", "payments", type_="foreignkey")
    op.alter_column("payments", "user_id", existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key("payments_user_id_fkey", "payments", "users", ["user_id"], ["id"], ondelete="CASCADE")
