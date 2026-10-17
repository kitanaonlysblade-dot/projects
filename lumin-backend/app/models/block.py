import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class UserBlock(Base):
    """`blocker` has blocked `blocked`. Hiding works both ways (see app/blocking.py): neither sees the
    other's videos, comments, products or profile in feeds and search."""

    __tablename__ = "user_blocks"

    blocker_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    blocked_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("ix_user_blocks_blocked_id", "blocked_id"),)
