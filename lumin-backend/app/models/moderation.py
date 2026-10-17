import enum
import uuid

from sqlalchemy import Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class ReportTargetType(str, enum.Enum):
    """What kind of thing got reported. target_id below is untyped (no
    FK) for the same reason Notification.target_id is — it points at a
    VideoPost, a Product, or a User depending on this field, and a
    single FK column can't point at more than one table. Resolved in
    the admin router based on this field, same pattern."""

    video_post = "video_post"
    product = "product"
    user = "user"


class ReportReason(str, enum.Enum):
    """A fixed set rather than free text, so the admin queue can filter
    and count by reason — "other" plus the optional `detail` field below
    covers whatever doesn't fit the other four."""

    spam = "spam"
    counterfeit = "counterfeit"
    inappropriate = "inappropriate"
    harassment = "harassment"
    other = "other"


class ReportStatus(str, enum.Enum):
    pending = "pending"
    # Looked at, no action taken — the report didn't hold up, or was a
    # duplicate of something already handled.
    reviewed = "reviewed"
    # Something was actually removed/banned as a direct result of this
    # report — kept distinct from `reviewed` so the admin analytics can
    # show what fraction of reports actually led to action.
    actioned = "actioned"


class Report(Base, TimestampMixin):
    """A user-filed report against a video post, product, or account —
    reviewed from the admin console, not the reported party's own
    dashboard (that's the whole point of this existing outside
    merchant.py). Nothing in the consumer frontend files one of these
    yet — this is the backend half, landing ahead of the report button
    the same way return_claim's dispute status landed ahead of the
    dispute-resolution UI that uses it.
    """

    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = uuid_pk()
    # SET NULL, not CASCADE — a report shouldn't vanish just because the
    # person who filed it later deletes their account; the content it
    # was filed against still needs reviewing.
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    target_type: Mapped[ReportTargetType] = mapped_column(Enum(ReportTargetType, name="report_target_type"))
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    reason: Mapped[ReportReason] = mapped_column(Enum(ReportReason, name="report_reason"))
    detail: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    status: Mapped[ReportStatus] = mapped_column(
        Enum(ReportStatus, name="report_status"), default=ReportStatus.pending
    )
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolution_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    reporter: Mapped["User | None"] = relationship(foreign_keys=[reporter_id])
    resolved_by: Mapped["User | None"] = relationship(foreign_keys=[resolved_by_id])


class AppealStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    denied = "denied"


class Appeal(Base, TimestampMixin):
    """A banned account's request to be unbanned. Reachable at all only
    because a banned account can still log in — see
    get_current_active_user's own comment in auth/dependencies.py for
    why that's the design rather than rejecting the token outright.
    One user can have more than one Appeal over time (a denied appeal
    doesn't block filing another later), but the admin router enforces
    "no second pending appeal while one's still open" itself rather than
    a database constraint, since that rule only applies to `pending` —
    any number of resolved ones are fine.
    """

    __tablename__ = "appeals"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    message: Mapped[str] = mapped_column(String(2000))
    status: Mapped[AppealStatus] = mapped_column(
        Enum(AppealStatus, name="appeal_status"), default=AppealStatus.pending
    )
    admin_response: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    user: Mapped["User"] = relationship(foreign_keys=[user_id], back_populates="appeals")
    resolved_by: Mapped["User | None"] = relationship(foreign_keys=[resolved_by_id])
