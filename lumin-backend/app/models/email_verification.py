import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, uuid_pk


class EmailVerificationCode(Base, TimestampMixin):
    """The 6-digit code mailed to someone to prove they own the email they signed up with. One row per account at
    a time (a new code replaces the old one). Only a hash is stored. `attempts` counts wrong guesses: after
    MAX_ATTEMPTS the code is dead and a new one must be requested."""

    __tablename__ = "email_verification_codes"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
