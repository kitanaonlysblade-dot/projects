import enum
import uuid

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Table, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class VideoFeed(str, enum.Enum):
    """The frontend keeps shop and discover posts as two separate arrays
    (shopPosts / discoverPosts in page.tsx) with no explicit type field
    on VideoPost itself — `feed` below makes that distinction an actual
    column instead of "which array/endpoint returned this row"."""

    shop = "shop"
    discover = "discover"


class VideoPost(Base, TimestampMixin):
    """Maps to VideoPost in lib/types.ts. merchant_id is set for shop
    posts and left null for a personal discover post — mirrors how
    handleAddShopPost vs. handleAddDiscoverPost are two separate paths
    in page.tsx, one from the merchant dashboard, one from a personal
    profile. `products` stays empty for discover posts, same as the
    frontend's comment that discover content "never shows shopping UI
    regardless of whether this array is empty or missing."
    """

    __tablename__ = "video_posts"

    id: Mapped[uuid.UUID] = uuid_pk()
    feed: Mapped[VideoFeed] = mapped_column(Enum(VideoFeed, name="video_feed"))
    poster_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    merchant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("merchant_accounts.id", ondelete="SET NULL"), nullable=True
    )
    # Set only on a repost row — a separate VideoPost whose own
    # description/video_url/thumbnail/width/height/products/interests
    # are never populated (see create_repost in routers/video_posts.py),
    # since _resolve_video_post_for_read there always reads all of that
    # off repost_of instead. Always points at a genuine original, never
    # at another repost — create_repost resolves through an existing
    # repost_of_id before creating a new row, so this never chains, and
    # a shop repost's product tags/merchant therefore always trace back
    # to the one real original post. ON DELETE CASCADE: deleting the
    # original takes every repost of it with it, same as deleting a
    # VideoPost already cascades its comments/watchlist/like rows.
    repost_of_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(2000), default="")
    video_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Auto-generated client-side today (generateVideoThumbnail in
    # MerchantPosts.tsx) as a data URL — once uploads move to real
    # storage this should become a real file URL instead, same as
    # video_url, not a data URL stored in the database.
    thumbnail_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    likes_count: Mapped[int] = mapped_column(Integer, default=0)
    comments_count: Mapped[int] = mapped_column(Integer, default=0)
    shares_count: Mapped[int] = mapped_column(Integer, default=0)
    saves_count: Mapped[int] = mapped_column(Integer, default=0)

    poster: Mapped["User"] = relationship(back_populates="video_posts", foreign_keys=[poster_id])
    merchant: Mapped["MerchantAccount | None"] = relationship(back_populates="video_posts")
    # remote_side=[id]: repost_of_id lives on the "many" (repost) side,
    # pointing back at the one original — see this column's own comment
    # above for why a repost's content/products/merchant all resolve
    # through this rather than living on the repost row itself.
    repost_of: Mapped["VideoPost | None"] = relationship(remote_side=[id], foreign_keys=[repost_of_id])
    products: Mapped[list["Product"]] = relationship(secondary="video_post_products")
    interests: Mapped[list["Interest"]] = relationship(secondary="video_post_interests")
    comments: Mapped[list["Comment"]] = relationship(
        back_populates="video_post", cascade="all, delete-orphan"
    )
    watchlisted_by: Mapped[list["User"]] = relationship(
        secondary="watchlist_items", back_populates="watchlist"
    )
    liked_by: Mapped[list["User"]] = relationship(
        secondary="post_likes", back_populates="liked_posts"
    )
    shared_by: Mapped[list["User"]] = relationship(
        secondary="post_shares", back_populates="shared_posts"
    )

    # Not columns — VideoPostRead exposes these two so the frontend can
    # render VideoPost.posterName/posterAvatar without a second request
    # per post. Routes that return a VideoPost must eager-load `poster`
    # (see joinedload(VideoPost.poster) in video_posts.py) or these turn
    # into one lazy-load query per row.
    @property
    def poster_display_name(self) -> str:
        return self.poster.display_name

    @property
    def poster_avatar_url(self) -> str | None:
        return self.poster.avatar_url


# Many-to-many — a shop post can tag several Products (see makeProducts
# calls feeding VideoPost.products in lib/data.ts).
video_post_products = Table(
    "video_post_products",
    Base.metadata,
    Column("video_post_id", UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), primary_key=True),
    Column("product_id", UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
)


class Interest(Base):
    """Maps to Interest in lib/types.ts — the topic chips in
    DiscoverOnboarding.tsx (useDiscoverInterests.ts)."""

    __tablename__ = "interests"

    id: Mapped[uuid.UUID] = uuid_pk()
    label: Mapped[str] = mapped_column(String(100))
    emoji: Mapped[str] = mapped_column(String(10))


# Many-to-many — VideoPost.interestIds on the frontend.
video_post_interests = Table(
    "video_post_interests",
    Base.metadata,
    Column("video_post_id", UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), primary_key=True),
    Column("interest_id", UUID(as_uuid=True), ForeignKey("interests.id", ondelete="CASCADE"), primary_key=True),
)


# Many-to-many — WatchlistScreen.tsx. No extra columns needed beyond the
# two ids, so a plain Table (not a mapped class) is enough here, same as
# `follows` in user.py.
watchlist_items = Table(
    "watchlist_items",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("video_post_id", UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), primary_key=True),
)


# Same shape as watchlist_items above — who's liked which post. Kept
# separate from VideoPost.likes_count (a denormalized counter, bumped
# whenever a row here is added/removed) rather than derived by counting
# this table on every read, same tradeoff the frontend's own comment on
# productActivity describes: a fast column to read, kept in sync at the
# one or two places that change it.
post_likes = Table(
    "post_likes",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("video_post_id", UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), primary_key=True),
)

# Same idea as post_likes — a real platform wouldn't usually let you
# "unshare," but the frontend's engagement rail already treated Share as
# a symmetric toggle right alongside Like (same activeEngagement state,
# same aria-pressed styling), so this mirrors that rather than quietly
# changing the interaction while just trying to persist it.
post_shares = Table(
    "post_shares",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("video_post_id", UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), primary_key=True),
)


class Comment(Base, TimestampMixin):
    """Maps to Comment in lib/types.ts — CommentsPanel.tsx. author_id is
    nullable with ondelete="SET NULL" so a deleted user's past comments
    stay visible (just detached from an account) rather than vanishing
    or cascading a delete through the whole comment thread.

    parent_id makes a comment a reply to another comment on the same
    post (one level deep — a reply's own replies still point at the
    same top-level parent, same flat-thread-with-a-parent-pointer shape
    CommentsPanel.tsx groups client-side, rather than true nesting).
    Unlike author_id, this one *does* cascade: a reply has no meaning
    once the comment it's replying to is gone, whereas a comment from a
    deleted account still stands on its own.
    """

    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = uuid_pk()
    video_post_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE")
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("comments.id", ondelete="CASCADE"), nullable=True
    )
    text: Mapped[str] = mapped_column(String(1000))
    likes_count: Mapped[int] = mapped_column(Integer, default=0)
    # Denormalized, bumped in add_comment when a reply is created — same
    # tradeoff as VideoPost.comments_count/likes_count described in this
    # file's own earlier comment (a fast column to read, kept in sync at
    # the one place that changes it) rather than counting `replies` on
    # every read.
    replies_count: Mapped[int] = mapped_column(Integer, default=0)
    # Facebook-style extras. `is_pinned` — the post's owner can pin one
    # top-level comment to the top of the thread. `edited_at` — set only
    # by edit_comment; the "(edited)" marker used to compare
    # updated_at/created_at, but updated_at also moves whenever a
    # reaction bumps likes_count, so every reacted-to comment looked
    # edited. `reply_to_*` — replies are still one level deep (they all
    # point at the top-level comment via parent_id), but replying to a
    # *reply* records who it was aimed at, so the UI can show
    # "Ada  nice one" the way Facebook does. Plain columns, no FK: a
    # second FK to users would make Comment.author ambiguous, and this
    # is display-only (a deleted account's name just stays as typed).
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reply_to_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    reply_to_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    video_post: Mapped["VideoPost"] = relationship(back_populates="comments")
    author: Mapped["User | None"] = relationship()
    parent: Mapped["Comment | None"] = relationship(back_populates="replies", remote_side=[id])
    replies: Mapped[list["Comment"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan"
    )
    liked_by: Mapped[list["User"]] = relationship(
        secondary="comment_likes", back_populates="liked_comments"
    )

    # Same idea as VideoPost.poster_display_name above — CommentRead needs
    # a name to actually show next to each comment, not just author_id.
    # Falls back to a fixed label rather than None so CommentsPanel never
    # has to special-case a missing author (e.g. one whose account was
    # deleted — author_id is SET NULL, not cascaded, specifically so the
    # comment itself survives that).
    @property
    def author_display_name(self) -> str:
        return self.author.display_name if self.author else "Deleted user"

    @property
    def author_avatar_url(self) -> str | None:
        return self.author.avatar_url if self.author else None


# Same shape as post_likes above, one level down — who's liked which
# comment. CommentRead.liked_by_me is computed per-request from this
# (see _annotate_comment_likes in routers/video_posts.py) rather than
# exposed as its own "my liked comment ids" endpoint, since — unlike
# post likes, which need to be known app-wide the moment posts load —
# comment likes are only ever needed for a thread that's already open.
comment_likes = Table(
    "comment_likes",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("comment_id", UUID(as_uuid=True), ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True),
)


# Facebook-style reactions on a comment — one row per (user, comment), the
# `reaction` column says which of REACTION_TYPES they picked. Replaces
# comment_likes as the source of truth (comment_likes stays defined above
# only so the User.liked_comments relationship and old databases keep
# working; ensure_schema.py copies any old likes in here as "like").
# Comment.likes_count is now "total reactions of any kind".
REACTION_TYPES = ("like", "love", "care", "haha", "wow", "sad", "angry")

comment_reactions = Table(
    "comment_reactions",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("comment_id", UUID(as_uuid=True), ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True),
    Column("reaction", String(12), nullable=False, server_default="like"),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
)
