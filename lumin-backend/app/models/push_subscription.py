import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk


class PushSubscription(Base):
    """One browser/device that agreed to get push notifications (Web Push). `endpoint` is the push service's
    address for that device and is unique; `p256dh` and `auth` are the keys the message is encrypted with."""

    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
