import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Column, Date, DateTime, Enum, ForeignKey, String, Table
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, ShippingAddressMixin, TimestampMixin, uuid_pk


class UserRole(str, enum.Enum):
    """Kept as an enum rather than a bare is_admin boolean — costs
    nothing extra now, and leaves room for e.g. a `moderator` tier later
    without a schema change, same reasoning as OrderStatus/NotificationType
    already being enums elsewhere in this codebase. There is deliberately
    no API route anywhere that can set a user's role to admin — the only
    way to create one is a direct database update. Keeping "become an
    admin" entirely outside the app's own reachable HTTP surface is the
    one non-negotiable part of this design; see get_current_admin in
    auth/dependencies.py for where this actually gets enforced.
    """

    user = "user"
    admin = "admin"


class User(Base, TimestampMixin, ShippingAddressMixin):
    """Maps to UserProfile in lib/types.ts, plus the auth fields that
    interface never needed — CreateAccountScreen.tsx fakes signup
    entirely client-side right now (its own comment says as much: "no
    real backend here"). hashed_password is nullable because the
    "Continue with Google" path (handleGoogleSignIn) won't have one.

    `following` / `followers` are plain integers on the frontend's
    UserProfile, but they're deliberately NOT stored as counters here —
    they're derived by counting rows in `follows` below instead, so they
    can never drift out of sync with who's actually following whom.

    The shipping_* columns (ShippingAddressMixin) are this user's saved
    default — nothing to do with any specific order. See that mixin's
    own docstring for the full reasoning; short version: checkout resolves
    an address from here when the person doesn't type a new one, and
    whatever address a successful checkout actually used gets written
    back here afterward (see payments.py's initialize_payment), so it's
    remembered as "last used" for next time without a separate save step.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Stored without the leading '@' the UI adds when displaying it —
    # see the cleanedUsername stripping in CreateAccountScreen.tsx.
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(100))
    bio: Mapped[str] = mapped_column(String(280), default="")
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Nullable — nothing collects this at signup, only a later profile
    # edit. Only ever read for its month/day (see
    # app/notifications.py's sync_birthday_notifications), never as an
    # actual age.
    birthday: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), default=UserRole.user)
    # Set only by the admin ban route (routers/admin.py) — null on every
    # account that's never been banned. is_active is the actual
    # enforcement switch (see get_current_active_user); these two are
    # just the record of why/when, shown back to the person on their own
    # suspension screen and carried into their appeal if they file one.
    # Cleared (both back to None) on unban — a fresh ban later gets its
    # own reason/timestamp, not a stale one from last time.
    ban_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    banned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A second, deliberately different kind of moderation action from
    # ban above — is_active stays True and get_current_active_user
    # doesn't check this at all, so a shadow-banned account can still
    # log in, post, comment, buy, everything, with no error and no
    # suspension screen. What actually changes is on the READING side:
    # routers/video_posts.py's list_video_posts/list_comments (the two
    # surfaces this reaches today) filter this account's content out of
    # what anyone else sees, while still showing it normally to the
    # account itself (and to an admin) — see _hide_shadow_banned in that
    # file for the actual enforcement. The account is never told; that's
    # the entire point, and also why there's no ban_reason/banned_at
    # equivalent here for the person to be shown — nothing is ever
    # surfaced to them about it.
    is_shadow_banned: Mapped[bool] = mapped_column(Boolean, default=False)
    # Settings screen toggles — were plain useState in page.tsx with no
    # persistence at all (reset on every refresh). Made real per-user
    # columns rather than localStorage so they follow the account across
    # devices/browsers, same reasoning as everything else that moved
    # from local-only state to here. Defaults match what those useState
    # calls defaulted to.
    autoplay_next: Mapped[bool] = mapped_column(Boolean, default=False)
    default_muted: Mapped[bool] = mapped_column(Boolean, default=True)
    # Instagram-style "private account" toggle, but scoped narrowly to
    # just the followers/following lists rather than gating the whole
    # profile or post visibility (posts, likes, bio, and the counts
    # themselves all stay public either way — see PersonResult's own
    # comment on why followers_count/following_count aren't gated by
    # this). Enforced in list_followers/list_following (routers/users.py):
    # anyone can still see *how many*, just not *who*, unless they're
    # looking at their own account.
    private_follow_lists: Mapped[bool] = mapped_column(Boolean, default=False)
    # A narrower cousin of private_follow_lists just above: whether OTHER
    # people get shown a "mutual followers" count/list when looking at
    # this account (list_mutual_followers below always honors this too,
    # on top of private_follow_lists — either one being on hides it).
    # Only gates the mutual-followers view itself; doesn't touch the
    # followers/following lists or counts.
    hide_mutual_followers: Mapped[bool] = mapped_column(Boolean, default=False)

    merchant_account: Mapped["MerchantAccount | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    video_posts: Mapped[list["VideoPost"]] = relationship(back_populates="poster")
    cart_items: Mapped[list["CartItem"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    orders: Mapped[list["Order"]] = relationship(back_populates="buyer")
    notifications: Mapped[list["Notification"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    watchlist: Mapped[list["VideoPost"]] = relationship(
        secondary="watchlist_items", back_populates="watchlisted_by"
    )
    liked_posts: Mapped[list["VideoPost"]] = relationship(
        secondary="post_likes", back_populates="liked_by"
    )
    shared_posts: Mapped[list["VideoPost"]] = relationship(
        secondary="post_shares", back_populates="shared_by"
    )
    liked_comments: Mapped[list["Comment"]] = relationship(
        secondary="comment_likes", back_populates="liked_by"
    )
    appeals: Mapped[list["Appeal"]] = relationship(
        foreign_keys="Appeal.user_id", back_populates="user", cascade="all, delete-orphan"
    )

    following: Mapped[list["User"]] = relationship(
        secondary="follows",
        primaryjoin="User.id == follows.c.follower_id",
        secondaryjoin="User.id == follows.c.followee_id",
        back_populates="followers",
    )
    followers: Mapped[list["User"]] = relationship(
        secondary="follows",
        primaryjoin="User.id == follows.c.followee_id",
        secondaryjoin="User.id == follows.c.follower_id",
        back_populates="following",
    )

    # Not columns (see the class docstring on why) — same pattern as
    # VideoPost.poster_display_name / Comment.author_display_name in
    # models/video.py: a plain property backed by the relationship, so
    # UserRead.model_validate(user) can read these straight off the
    # object like any other field. (The routers/auth.py helper that used
    # to patch these in afterward via .model_copy() didn't actually
    # work — model_validate raises on a missing required field before
    # model_copy ever runs, which is the 500 this replaces.)
    @property
    def following_count(self) -> int:
        return len(self.following)

    @property
    def followers_count(self) -> int:
        return len(self.followers)


# Self-referential many-to-many — who follows whom. Powers the
# `following` / `followers` counts on ProfileScreen without storing
# them directly (see the comment on User above).
follows = Table(
    "follows",
    Base.metadata,
    Column(
        "follower_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "followee_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)
