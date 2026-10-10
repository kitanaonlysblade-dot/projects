import uuid
from datetime import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.video import TwinReviewStatus, VideoFeed

from .catalog import ProductRead


class InterestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    emoji: str


ReactionType = Literal["like", "love", "care", "haha", "wow", "sad", "angry"]


class CommentBase(BaseModel):
    # Trimmed, and 1-1000 chars after trimming: an empty/whitespace-only
    # comment used to reach the DB, and the column is String(1000) so a
    # longer one would 500 instead of getting a clean 422.
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=1000)


class CommentCreate(CommentBase):
    # Set to reply to another comment on the same post rather than post
    # a new top-level one — see add_comment's own validation that this
    # actually belongs to the post being commented on. May point at a
    # reply too: add_comment files it under that reply's top-level
    # comment and records who it was aimed at (reply_to_name).
    parent_id: uuid.UUID | None = None


class CommentUpdate(CommentBase):
    """Just the text — editing a comment doesn't let you move it to a
    different post or turn a reply into a top-level comment (or vice
    versa). See edit_comment in routers/video_posts.py for the
    author-only check this doesn't itself enforce."""


class CommentRead(CommentBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    video_post_id: uuid.UUID
    author_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    # Read straight off Comment's own properties (see the model) —
    # requires the route to have loaded `author`, same requirement as
    # VideoPostRead.poster_display_name below.
    author_display_name: str
    author_avatar_url: str | None = None
    likes_count: int
    replies_count: int
    # Not a real column — set per-request by _annotate_comment_likes in
    # routers/video_posts.py before this gets built, same "attach it to
    # the ORM instance, from_attributes picks it up via getattr" trick
    # used nowhere else in this file since nothing else here is
    # per-viewer state layered onto a shared row.
    liked_by_me: bool = False
    # Facebook-style reactions. my_reaction is the viewer's own pick (None
    # if they haven't reacted); reaction_counts maps reaction -> how many
    # people picked it (only non-zero entries). Both are per-request
    # attributes set by _annotate_comments, same trick as liked_by_me.
    my_reaction: str | None = None
    reaction_counts: dict[str, int] = {}
    is_pinned: bool = False
    reply_to_user_id: uuid.UUID | None = None
    reply_to_name: str | None = None
    edited_at: datetime | None = None
    created_at: datetime
    # Lets CommentsPanel.tsx show an "(edited)" marker — same
    # server_default-then-onupdate column every other TimestampMixin
    # table has, just not previously surfaced here since nothing could
    # change a comment after it was posted until edit_comment existed.
    # Equal to created_at for a never-edited comment (both default to
    # the same INSERT-time now()).
    updated_at: datetime


class CommentReactionSet(BaseModel):
    reaction: ReactionType


class CommentReactorRead(BaseModel):
    """One row of the "who reacted" list (tap the reaction summary under
    a comment)."""

    id: uuid.UUID
    display_name: str
    avatar_url: str | None = None
    reaction: str


class VideoPostBase(BaseModel):
    description: str = ""
    video_url: str | None = None
    thumbnail_url: str | None = None
    width: int | None = None
    height: int | None = None


from app.twin_config import MIN_TWIN_MS  # noqa: E402,F401  (tunable, see twin_config)
MAX_TWIN_MS = 6 * 60 * 60 * 1000


class TwinInput(BaseModel):
    """A product paired with when it appears. `label` is the short name
    the shop pill shows ("bag"), chosen by the merchant."""

    model_config = ConfigDict(str_strip_whitespace=True)

    product_id: uuid.UUID
    label: str = Field(min_length=1, max_length=24)
    start_ms: int = Field(ge=0, le=MAX_TWIN_MS)
    end_ms: int = Field(ge=0, le=MAX_TWIN_MS)

    @model_validator(mode="after")
    def _long_enough(self):
        if self.end_ms - self.start_ms < MIN_TWIN_MS:
            raise ValueError(f"A twin must last at least {MIN_TWIN_MS / 1000:g} second(s)")
        return self


class TwinRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    # Which post the twin belongs to — on a retwin the feed entry carries the
    # original's twins as well, and the client needs to tell them apart.
    video_post_id: uuid.UUID
    product_id: uuid.UUID
    label: str
    start_ms: int
    end_ms: int
    review_status: TwinReviewStatus


class RetwinOriginal(BaseModel):
    """What a retwin needs to play the original alongside itself."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    poster_display_name: str
    video_url: str | None = None
    lite_video_url: str | None = None
    thumbnail_url: str | None = None
    width: int | None = None
    height: int | None = None


class RetwinSummary(BaseModel):
    """A product retwin, as listed on the original it tags ("also tagged by …")."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    poster_display_name: str
    poster_avatar_url: str | None = None


class TwinPoolItem(BaseModel):
    """A moment somebody already holds (original or another retwin)."""

    video_post_id: uuid.UUID
    start_ms: int
    end_ms: int
    label: str
    product_name: str


class VideoPostCreate(VideoPostBase):
    feed: VideoFeed
    # Both empty for a discover post — same as the model's comment that
    # discover content never shows shopping UI regardless of whether
    # this array is empty or missing.
    product_ids: list[uuid.UUID] = []
    interest_ids: list[uuid.UUID] = []
    # Required for every product on a shop post (checked in the router).
    twins: list[TwinInput] = []


class VideoPostUpdate(BaseModel):
    """Every field optional, same PATCH-only-sends-what-changed pattern
    as ProductUpdate. `feed` isn't editable — a shop post can't turn
    into a discover post after the fact."""

    description: str | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    width: int | None = None
    height: int | None = None
    product_ids: list[uuid.UUID] | None = None
    interest_ids: list[uuid.UUID] | None = None
    twins: list[TwinInput] | None = None
    sync_offset_ms: int | None = Field(default=None, ge=-30000, le=30000)


class RepostedBy(BaseModel):
    """Who reposted this — see VideoPostRead.reposted_by below."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    avatar_url: str | None = None


class VideoPostRead(VideoPostBase):
    model_config = ConfigDict(from_attributes=True)

    lite_video_url: str | None = None
    # Viewing stats (see VideoPost.views_count).
    views_count: int = 0
    unique_viewers_count: int = 0
    watch_seconds_total: float = 0
    completions_count: int = 0

    id: uuid.UUID
    feed: VideoFeed
    poster_id: uuid.UUID
    # VideoPost.poster_display_name/poster_avatar_url are properties, not
    # columns (see the model) — the frontend's VideoPost.posterName/
    # posterAvatar need a real value on every post, and a second request
    # per post just to resolve a name isn't worth it. Requires the route
    # to eager-load `poster` (joinedload in video_posts.py), or these
    # trigger a lazy-load query per row instead.
    poster_display_name: str
    poster_avatar_url: str | None = None
    merchant_id: uuid.UUID | None = None
    likes_count: int
    comments_count: int
    shares_count: int
    saves_count: int
    products: list[ProductRead] = []
    interests: list[InterestRead] = []
    # Empty on posts made before twinning existed (the shop pill then
    # keeps its old whole-video behaviour).
    twins: list[TwinRead] = []
    # Set only on a retwin: the original it plays alongside. On a retwin,
    # `products` and `twins` above are the merged set (original's + its own).
    retwin_of_id: uuid.UUID | None = None
    retwin_of: RetwinOriginal | None = None
    # 'video' | 'product' on a retwin, None otherwise. tag_only is the same fact as a bool.
    retwin_kind: str | None = None
    tag_only: bool = False
    sync_offset_ms: int = 0
    # On an original: who has tagged their products onto it (product retwins).
    product_retwins: list[RetwinSummary] = []
    # The repost's own created_at when this entry is a repost, not the
    # original's — same as a retweet showing up with a fresh timestamp
    # in whoever's feed it lands in, even though every field above still
    # describes the original's actual content. Ordering already used
    # this same distinction before it ever reached serialization (the
    # feed query sorts the raw table, repost rows included, by their own
    # created_at) — this just carries that through into what's shown.
    created_at: datetime
    # Both None for an original post. Set together, only on a repost
    # entry — `id` and every content field above still describe the
    # ORIGINAL post (interactions, product tags, and attribution always
    # belong to it, never to the repost); these two are the only things
    # about this particular feed entry that are actually the reposter's
    # own. `repost_id` is the repost row's own id — VideoStage.tsx has
    # no use for it today (interactions target `id`, the original, same
    # as always) beyond a stable React key when the same original could
    # otherwise appear twice in one feed page. See
    # _resolve_video_post_for_read in routers/video_posts.py, which is
    # what actually builds this shape — from_attributes alone can't,
    # since a raw repost row's own content columns are never populated.
    repost_id: uuid.UUID | None = None
    reposted_by: RepostedBy | None = None


class VideoViewStart(BaseModel):
    # Anonymous viewers send a device id the app generated; ignored for
    # logged-in viewers (their account id is used instead).
    viewer_key: str | None = Field(default=None, max_length=64)


class VideoViewStarted(BaseModel):
    # None when this play isn't tracked (the poster watching their own post).
    view_id: uuid.UUID | None = None


class VideoViewProgress(BaseModel):
    # Seconds actually played since the last report — a delta, not a total.
    watch_seconds: float = Field(default=0, ge=0, le=3600)
    completed: bool = False


class ProductTap(BaseModel):
    product_id: uuid.UUID


class PostFunnelRead(BaseModel):
    """Owner-only shopping funnel for one of the caller's shop posts. Views
    and watch time are on VideoPostRead; these are the later steps."""

    video_post_id: uuid.UUID
    product_taps: int = 0
    cart_adds: int = 0
    orders: int = 0
    revenue: float = 0


class TwinReviewRead(BaseModel):
    """Admin review queue row."""

    id: uuid.UUID
    video_post_id: uuid.UUID
    video_url: str | None
    thumbnail_url: str | None
    poster_name: str
    product_id: uuid.UUID
    product_name: str
    label: str
    start_ms: int
    end_ms: int
    review_status: TwinReviewStatus
    created_at: datetime


class TwinReviewAction(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    status: Literal["approved", "flagged"]
    reason: str | None = Field(default=None, max_length=300)
