import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk


class PushDevice(Base):
    """A phone running the native app (Android or iPhone) that agreed to push notifications. `token` is the Firebase
    Cloud Messaging registration token for that install (FCM delivers to Android directly and to iPhones through
    Apple's service). The browser equivalent is PushSubscription."""

    __tablename__ = "push_devices"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(500), unique=True)
    platform: Mapped[str] = mapped_column(String(10))  # android | ios
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
