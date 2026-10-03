import enum
import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class NotificationType(str, enum.Enum):
    product = "product"
    order = "order"
    # A moderation action affecting this user directly — their listing
    # was removed, a return claim they're party to (buyer or seller) was
    # resolved, or their ban/appeal status changed. target_id is unused
    # for this type, same as it already is for `order` — the body text
    # itself carries what happened; there's no single screen this could
    # deep-link into the way a product notification links to that
    # product.
    moderation = "moderation"
    # Someone followed this user — target_id is the new follower's User
    # id. Created in routers/users.py's follow_user, right alongside the
    # `follows` row itself.
    follow = "follow"
    # A followed account's birthday, as of today — target_id is that
    # account's User id. Created lazily by
    # app/notifications.py's sync_birthday_notifications, called at the
    # top of GET /notifications rather than by any kind of scheduled
    # job (this app has no background-task infra); see that function's
    # own comment for the idempotency check that keeps it from creating
    # a duplicate every time the notifications screen is opened on the
    # same day.
    birthday = "birthday"
    # Someone liked your video post — target_id is the VideoPost.id, so
    # the frontend can open that post the same way a shared link does.
    # Created in like_video_post; never on unlike_video_post (an unlike
    # has nothing worth notifying about). Skipped when you like your own
    # post — see that route's own comment.
    post_like = "post_like"
    # Someone left a new top-level comment on your video post —
    # target_id is the VideoPost.id. Created in add_comment, only for
    # payload.parent_id is None (a reply is comment_reply below
    # instead, even though it's still technically a comment on the
    # post — that split matches what Facebook's own notification copy
    # distinguishes: "commented on your post" vs. "replied to your
    # comment").
    post_comment = "post_comment"
    # Someone replied to one of your comments (or replies) — target_id
    # is the VideoPost.id the thread lives on, same reason post_comment
    # points at the post rather than the comment: this app has no
    # scroll-to-comment deep link, so opening the post's own comments
    # panel is as specific as a tap can get. Created in add_comment for
    # whoever wrote the comment actually being replied to (not
    # necessarily the top-level comment's author — see that route's own
    # comment on reply-to-a-reply).
    comment_reply = "comment_reply"
    # Someone reacted to one of your comments — target_id is the
    # VideoPost.id, same reasoning as comment_reply. Created in
    # _set_reaction only the first time a person reacts (switching from
    # one reaction to another, or clearing it, doesn't notify again —
    # see that function's own comment).
    comment_reaction = "comment_reaction"


class Notification(Base, TimestampMixin):
    """Maps to Notification in lib/types.ts — NotificationsScreen.tsx.
    target_id is untyped on purpose (no FK constraint): it points at a
    Product.id when type == 'product', a User.id when type == 'follow'
    or 'birthday', and is unused for type == 'order'/'moderation' — same
    dual-purpose field the frontend's own comment on Notification
    describes (the frontend collapses follow/birthday into its own
    'user' type, since both mean "open this person's profile" — see
    lib/adapters.ts's apiNotificationToNotification). A FK would have to
    allow pointing at more than one table, which Postgres can't express
    directly — cheaper to leave it as a plain UUID and resolve it in the
    API layer based on `type`.
    """

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    body: Mapped[str] = mapped_column(String(500))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    type: Mapped[NotificationType | None] = mapped_column(
        Enum(NotificationType, name="notification_type"), nullable=True
    )
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="notifications")
