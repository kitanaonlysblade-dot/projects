import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class PasswordResetToken(Base, TimestampMixin):
    """One row per "forgot password" request (routers/auth.py's
    forgot_password). Stores a hash of the token, never the raw value —
    same reasoning User.hashed_password never stores a plain password:
    if this table ever leaked, a raw token would let an attacker reset
    anyone's password directly, while a hash is useless without the
    original value that only ever existed in the email actually sent to
    the account holder. Hashed with plain sha256 (see reset_password's
    own comment), not bcrypt — this is a high-entropy random value, not
    a human-chosen secret, so there's nothing for a slow hash to protect
    against here that a fast one doesn't already.

    used_at is nullable rather than a boolean "used" flag — keeps *when*
    it was used, which a flag would throw away, for basically free.

    Nothing purges expired/used rows. A real deployment would want a
    periodic cleanup job; an unbounded row per reset request isn't a
    real problem at this app's scale, and adding a scheduled-job system
    just for that housekeeping isn't worth it yet.
    """

    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()
