import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class TrafficSource(Base, TimestampMixin):
    """One row per app session-start, capturing acquisition context —
    where the session came from, not what it did once it got here. This
    is deliberately NOT pageview/event tracking: no screen-by-screen
    history, no per-action logging, just enough to answer "where do our
    sessions/signups actually come from" when the admin analytics
    dashboard groups these by day/month/year (created_at, from
    TimestampMixin, is the grouping key). Ingested via POST /traffic
    (routers/traffic.py), called once per app load from the frontend —
    see that route's own comment for why it accepts an anonymous caller.

    user_id is nullable and set only when the session belongs to
    someone already logged in at the moment it fired — most sessions
    captured here are pre-login (that's the whole point: knowing where
    a visitor came from before they ever created an account), so leaving
    it null is the common case, not a data-quality gap.
    """

    __tablename__ = "traffic_sources"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # The browser's own document.referrer — whatever page (if any)
    # linked here. Free text, not parsed into a domain, since a raw
    # referrer is still directly useful in the admin dashboard's own
    # breakdown and parsing it further can always be done in that query
    # later without touching how this is stored.
    referrer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    utm_source: Mapped[str | None] = mapped_column(String(200), nullable=True)
    utm_medium: Mapped[str | None] = mapped_column(String(200), nullable=True)
    utm_campaign: Mapped[str | None] = mapped_column(String(200), nullable=True)

    user: Mapped["User | None"] = relationship()
