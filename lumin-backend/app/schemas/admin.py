import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.user import UserRole


class AdminUserRead(BaseModel):
    """A thin admin-facing user record — GET /admin/users. Deliberately
    not UserRead: this needs email and ban status front-and-center for
    a moderation queue, not shipping_address or the autoplay/mute
    settings UserRead exposes to the account's own owner."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str
    email: str
    role: UserRole
    is_active: bool
    ban_reason: str | None = None
    banned_at: datetime | None = None
    is_shadow_banned: bool
    created_at: datetime


class UserBanRequest(BaseModel):
    reason: str | None = None


class AnalyticsPoint(BaseModel):
    """One bucket of GET /admin/analytics/summary's time series.
    period_start is the bucket's own start (the first instant of that
    day/month/year, matching whichever `period` the request asked for),
    not just a display label — the frontend chart reads it as a real
    date on its x-axis."""

    period_start: date
    order_count: int
    revenue: Decimal


class TopProductRead(BaseModel):
    product_id: uuid.UUID
    name: str
    units_sold: int
    revenue: Decimal


class TrendingPostRead(BaseModel):
    video_post_id: uuid.UUID
    description: str
    poster_display_name: str
    likes_count: int
    comments_count: int
    shares_count: int
    saves_count: int
    engagement_total: int


class TrafficSourcePoint(BaseModel):
    period_start: date
    # utm_source when present, else the raw referrer, else the literal
    # string "direct" — see the query in routers/admin.py for exactly
    # how that fallback chain is built.
    source: str
    session_count: int
